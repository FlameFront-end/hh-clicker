"""Extract pasted browser cookies without executing any part of a shell command."""

import re


def _ansi_decode(value: str) -> str:
    escapes = {"a": "\a", "b": "\b", "e": "\x1b", "E": "\x1b", "f": "\f",
               "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\",
               "'": "'", '"': '"', "?": "?"}

    def replace(match):
        code = match.group()[1:]
        if code in escapes:
            return escapes[code]
        if code[0] in "01234567":
            return chr(int(code, 8))
        if code[0] in "xuU" and len(code) > 1:
            number = int(code[1:], 16)
            return chr(number) if number <= 0x10ffff else match.group()
        return match.group()

    return re.sub(r"\\(?:[0-7]{1,3}|x[\da-fA-F]{1,2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|[\s\S])", replace, value)


def _shell_words(command: str) -> list[str]:
    """POSIX/browser cURL quoting, including Bash $'…'; no expansions or I/O."""
    words, word = [], []
    i, started = 0, False
    while i < len(command):
        ch = command[i]
        if ch.isspace():
            if started:
                words.append("".join(word))
                word, started = [], False
            i += 1
            continue
        ansi = command.startswith("$'", i)
        if ansi or ch in "'\"":
            quote = "'" if ansi else ch
            i += 2 if ansi else 1
            started = True
            segment = []
            while i < len(command) and command[i] != quote:
                ch = command[i]
                if ch == "\\" and (ansi or quote == '"'):
                    if i + 1 >= len(command):
                        raise ValueError("Incomplete quoted argument")
                    nxt = command[i + 1]
                    if ansi:
                        segment.extend((ch, nxt))
                        i += 2
                        continue
                    if nxt in '$`"\\\n':
                        if nxt != "\n":
                            segment.append(nxt)
                        i += 2
                        continue
                segment.append(ch)
                i += 1
            if i >= len(command):
                raise ValueError("Unclosed quoted argument")
            text = "".join(segment)
            word.append(_ansi_decode(text) if ansi else text)
            i += 1
        elif ch == "\\":
            if i + 1 >= len(command):
                raise ValueError("Incomplete escape")
            if command[i + 1] != "\n":
                word.append(command[i + 1])
                started = True
            i += 2
        else:
            word.append(ch)
            started = True
            i += 1
    if started:
        words.append("".join(word))
    return words


def parse_cookies_str(raw: str) -> tuple[dict[str, str], str]:
    raw = raw.strip()
    if re.match(r"^curl(?:\.exe)?\s", raw):
        try:
            words = _shell_words(raw)
        except ValueError:
            return {}, ""
        lines = []
        i = 1
        while i < len(words):
            arg = words[i]
            if arg == "--":
                break
            value, header = None, False
            if arg in ("-b", "--cookie", "-H", "--header"):
                i += 1
                if i >= len(words):
                    return {}, ""
                value, header = words[i], arg in ("-H", "--header")
            elif arg.startswith(("--cookie=", "--header=")):
                value = arg.split("=", 1)[1]
                header = arg.startswith("--header=")
            elif arg.startswith(("-b", "-H")) and len(arg) > 2:
                value, header = arg[2:], arg.startswith("-H")
            if value is not None:
                if header:
                    name, sep, value = value.partition(":")
                    if not sep or name.strip().lower() != "cookie":
                        i += 1
                        continue
                # A cURL cookie-file argument is deliberately not read.
                if "=" in value:
                    lines.append(value.strip())
            i += 1
        raw_line = "; ".join(lines)
    else:
        raw_line = raw[7:].strip() if raw.lower().startswith("cookie:") else raw

    cookies = {}
    for part in raw_line.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        key = key.strip()
        value = "".join(ch for ch in value.strip() if ch == "\t" or 0x20 <= ord(ch) < 0x7f or ord(ch) >= 0xa0)
        if value and re.fullmatch(r"[!#$%&'*+.^_`|~0-9a-zA-Z-]+", key):
            cookies[key] = value
    # Validation and persistence must use the same sanitized cookie values.
    return cookies, "; ".join(f"{key}={value}" for key, value in cookies.items())
