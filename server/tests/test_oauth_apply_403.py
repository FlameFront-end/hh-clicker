from unittest.mock import patch

from app import oauth


class Response403:
    status_code = 403
    text = "forbidden"

    @staticmethod
    def json():
        return {"errors": [{"type": "forbidden", "value": "vacancy_not_available"}]}


def test_apply_403_does_not_invalidate_valid_oauth_token():
    acc = {"resume_hash": "resume", "cookies": {"hhtoken": "cookie"}}
    with patch.object(oauth, "_obtain_oauth_token", return_value="valid-token"), \
         patch.object(oauth.HH, "post", return_value=Response403()), \
         patch.object(oauth, "invalidate_oauth_token") as invalidate:
        result, info = oauth._oauth_apply(acc, "vacancy")
    assert result == "error"
    assert info["http_status"] == 403
    invalidate.assert_not_called()


def test_captcha_403_preserves_challenge_without_invalidating_token():
    class Challenge(Response403):
        @staticmethod
        def json():
            return {"errors": [{"value": "captcha_required", "captcha_url": "https://hh.ru/captcha?state=test"}]}

    with patch.object(oauth, "_obtain_oauth_token", return_value="valid-token"), \
         patch.object(oauth.HH, "post", return_value=Challenge()), \
         patch.object(oauth, "invalidate_oauth_token") as invalidate:
        result, info = oauth._oauth_apply({"resume_hash": "resume"}, "vacancy")
    assert result == "captcha"
    assert info["captcha_url"] == "https://hh.ru/captcha?state=test"
    invalidate.assert_not_called()


def test_challenge_rejects_untrusted_urls():
    from app.captcha import captcha_info
    for url in ("https://evil.test/", "javascript:alert(1)", "https://hh.ru.evil.test/", "https://user@hh.ru/"):
        assert captcha_info({"errors": [{"value": "captcha_required", "captcha_url": url}]})["captcha_url"] == ""
