"""Last-moment cancellation for cycle-scoped, state-changing HH requests."""


class DispatchCancelled(RuntimeError):
    pass


class MessageSendUncertain(RuntimeError):
    """HH may have accepted the message; never repeat via another endpoint."""


def dispatch_allowed(acc):
    guard = acc.get("_dispatch_guard")
    return guard is None or bool(guard())
