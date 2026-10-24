import pytest

from app.cookie_parser import parse_cookies_str


@pytest.mark.parametrize("flag", ["-b", "--cookie", "--cookie="])
def test_full_browser_curl_with_json_and_ansi_quotes(flag):
    sep = "" if flag.endswith("=") else " "
    command = (
        "curl --url 'https://chatik.hh.ru/chatik/api/unread' \\\n"
        " -H 'accept: application/json' \\\n"
        f" {flag}{sep}$'hhtoken=test-token; filters123={{\"showFilters\":false}}; "
        "name=O\\'Brien; _xsrf=test-xsrf; hhrole=applicant'"
    )
    cookies, line = parse_cookies_str(command)
    assert cookies["hhtoken"] == "test-token"
    assert cookies["_xsrf"] == "test-xsrf"
    assert cookies["filters123"] == '{"showFilters":false}'
    assert cookies["name"] == "O'Brien"
    assert "_xsrf=test-xsrf" in line


@pytest.mark.parametrize("prefix", ["-H ", "--header ", "--header="])
def test_cookie_header_with_opposite_quotes(prefix):
    cookies, _ = parse_cookies_str(
        "curl 'https://hh.ru/' " + prefix + "'cOoKiE: hhtoken=test; filters={\"a\":1}; _xsrf=xsrf'"
    )
    assert cookies["_xsrf"] == "xsrf"
    assert cookies["filters"] == '{"a":1}'


def test_double_quotes_escaped_json_and_unicode():
    cookies, _ = parse_cookies_str(
        r'''curl https://hh.ru/ -b "hhtoken=test; filters={\"a\":1}; name=Артём; _xsrf=xsrf"'''
    )
    assert cookies["filters"] == '{"a":1}'
    assert cookies["name"] == "Артём"
    assert cookies["_xsrf"] == "xsrf"


def test_ansi_escapes_are_decoded_once_without_corrupting_unicode():
    cookies, _ = parse_cookies_str(
        r"curl https://hh.ru/ -b $'hhtoken=test\041; _xsrf=xsrf\x21; name=Артём; slash=\\u0041'"
    )
    assert cookies == {"hhtoken": "test!", "_xsrf": "xsrf!", "name": "Артём", "slash": r"\u0041"}


@pytest.mark.parametrize("prefix", ["", "Cookie: "])
def test_plain_cookie_values_are_not_shell_decoded(prefix):
    cookies, _ = parse_cookies_str(prefix + r'hhtoken=test; _xsrf=xsrf; json={"path":"C:\temp"}')
    assert cookies["json"] == r'{"path":"C:\temp"}'


def test_multiple_cookie_options_and_attached_short_options():
    cookies, _ = parse_cookies_str("curl https://hh.ru/ -b'hhtoken=old' -b'hhtoken=new' -H'Cookie: _xsrf=test'")
    assert cookies == {"hhtoken": "new", "_xsrf": "test"}


@pytest.mark.parametrize("command", [
    "curl https://hh.ru/ -b 'unclosed", "curl https://hh.ru/ --cookie",
    "curl https://hh.ru/ --cookie /private/cookies.txt", "curl https://hh.ru/ -H 'accept: */*'",
])
def test_invalid_input_and_cookie_files_are_not_read(command):
    assert parse_cookies_str(command) == ({}, "")


def test_shell_expressions_are_inert(tmp_path):
    target = tmp_path / "must-not-exist"
    cookies, _ = parse_cookies_str(f"curl https://hh.ru/ -b 'hhtoken=$(touch {target}); _xsrf=`id`'")
    assert cookies["_xsrf"] == "`id`"
    assert not target.exists()


def test_control_characters_are_removed_from_forwarded_line():
    cookies, line = parse_cookies_str(r"curl https://hh.ru/ -b $'hhtoken=test\r\n; _xsrf=xsrf\000'")
    assert cookies == {"hhtoken": "test", "_xsrf": "xsrf"}
    assert line == "hhtoken=test; _xsrf=xsrf"


def test_embedded_fake_option_in_request_body_is_not_a_cookie():
    assert parse_cookies_str('curl https://hh.ru/ --data \'{"command":"-b \\\"hhtoken=fake; _xsrf=fake\\\""}\'') == ({}, "")
