import json
import os
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

from playwright.sync_api import expect


APP_URL = os.environ.get('OUTBOUND_UI_URL', 'http://localhost:4173/')
API_BASE_URL = os.environ.get(
    'OUTBOUND_API_URL', 'http://127.0.0.1:8788'
).rstrip('/')
ADMIN_USERNAME = os.environ.get('CONSOLE_ADMIN_USERNAME', 'fc6j1')
ADMIN_PASSWORD = os.environ.get('CONSOLE_ADMIN_PASSWORD', 'fc6j18888')

_api_opener = None


def login_operator(page) -> None:
    logout = page.get_by_role('button', name='退出登录')
    if logout.count() and logout.is_visible():
        return
    heading = page.get_by_role('heading', name='登录运营后台')
    expect(heading).to_be_visible()
    page.get_by_label('管理员账号').fill(ADMIN_USERNAME)
    page.get_by_label('登录密码').fill(ADMIN_PASSWORD)
    page.get_by_role('button', name='登录', exact=True).click()
    expect(logout).to_be_visible()


def open_authenticated(page, url: str = APP_URL) -> None:
    page.goto(url, wait_until='networkidle')
    login_operator(page)


def authenticated_api_json(path: str) -> dict:
    opener = _authenticated_api_opener()
    request = Request(
        f'{API_BASE_URL}{path}',
        headers={'x-actor-id': ADMIN_USERNAME},
    )
    with opener.open(request, timeout=10) as response:
        return json.load(response)['data']


def _authenticated_api_opener():
    global _api_opener
    if _api_opener is not None:
        return _api_opener

    opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
    request = Request(
        f'{API_BASE_URL}/api/v1/operator-session',
        method='POST',
        headers={'content-type': 'application/json'},
        data=json.dumps(
            {'username': ADMIN_USERNAME, 'password': ADMIN_PASSWORD}
        ).encode('utf-8'),
    )
    with opener.open(request, timeout=10) as response:
        payload = json.load(response)
    if payload.get('data', {}).get('username') != ADMIN_USERNAME:
        raise AssertionError('Local operator login returned an unexpected identity')
    _api_opener = opener
    return opener
