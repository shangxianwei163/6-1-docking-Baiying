from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from ui_auth import ADMIN_PASSWORD, ADMIN_USERNAME, APP_URL


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
LOGIN_SCREENSHOT = Path('/tmp/outbound-platform-operator-login.png')
AUTHENTICATED_SCREENSHOT = Path('/tmp/outbound-platform-operator-authenticated.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-operator-login-mobile.png')


def assert_no_horizontal_overflow(page, label: str) -> None:
    document_width = page.evaluate('document.documentElement.scrollWidth')
    viewport_width = page.evaluate('window.innerWidth')
    if document_width > viewport_width + 1:
        raise AssertionError(
            f'{label} overflows horizontally: '
            f'{document_width}px > {viewport_width}px'
        )


def main() -> None:
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(APP_URL, wait_until='networkidle')

        expect(page.get_by_role('heading', name='登录运营后台')).to_be_visible()
        expect(page.get_by_label('管理员账号')).to_have_attribute(
            'autocomplete', 'username'
        )
        expect(page.get_by_label('登录密码')).to_have_attribute(
            'autocomplete', 'current-password'
        )
        expect(page.get_by_label('登录密码')).to_have_attribute('type', 'password')
        page.screenshot(path=str(LOGIN_SCREENSHOT), full_page=True)

        page.get_by_label('管理员账号').fill(ADMIN_USERNAME)
        page.get_by_label('登录密码').fill('definitely-wrong-password')
        page.get_by_role('button', name='登录', exact=True).click()
        expect(page.get_by_role('alert')).to_have_text('账号或密码错误')
        expect(page.get_by_role('heading', name='登录运营后台')).to_be_visible()

        page.get_by_label('登录密码').fill(ADMIN_PASSWORD)
        page.get_by_role('button', name='登录', exact=True).click()
        expect(page.get_by_role('button', name='退出登录')).to_be_visible()
        expect(page.locator('h2').filter(has_text='总览')).to_be_visible()
        expect(page.get_by_text('平台管理员', exact=True)).to_be_visible()
        assert_no_horizontal_overflow(page, 'Authenticated desktop console')
        page.screenshot(path=str(AUTHENTICATED_SCREENSHOT), full_page=True)

        second_page = context.new_page()
        second_page.on('pageerror', lambda error: page_errors.append(str(error)))
        second_page.goto(APP_URL, wait_until='networkidle')
        expect(second_page.get_by_role('button', name='退出登录')).to_be_visible()
        expect(
            second_page.get_by_role('heading', name='登录运营后台')
        ).not_to_be_visible()

        page.get_by_role('button', name='退出登录').click()
        expect(page.get_by_role('heading', name='登录运营后台')).to_be_visible()
        second_page.reload(wait_until='networkidle')
        expect(
            second_page.get_by_role('heading', name='登录运营后台')
        ).to_be_visible()
        context.close()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        mobile.goto(APP_URL, wait_until='networkidle')
        expect(mobile.get_by_role('heading', name='登录运营后台')).to_be_visible()
        assert_no_horizontal_overflow(mobile, 'Mobile login page')
        mobile.screenshot(path=str(MOBILE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Operator login UI verification passed '
        '(invalid login + valid login + shared session + logout + mobile layout)'
    )
    print(f'Login screenshot: {LOGIN_SCREENSHOT}')
    print(f'Authenticated screenshot: {AUTHENTICATED_SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
