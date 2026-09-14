from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from ui_auth import open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
DESKTOP_SCREENSHOT = Path('/tmp/outbound-platform-navigation.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-navigation-mobile.png')


def group(nav, label: str):
    return nav.locator('.nav-group').filter(has_text=label)


def assert_group_items(nav, label: str, expected: list[str]) -> None:
    section = group(nav, label)
    expect(section).to_have_count(1)
    submenu = section.locator('.nav-submenu')
    actual = submenu.locator('button').all_inner_texts()
    if actual != expected:
        raise AssertionError(f'{label} items mismatch: {actual}')


def main() -> None:
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )

        desktop = browser.new_page(viewport={'width': 1600, 'height': 1000})
        desktop.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(desktop)
        nav = desktop.get_by_role('navigation', name='平台功能菜单')

        assert_group_items(
            nav,
            '初始管理',
            ['线路管理', '字段映射', '数据分类', '话术列表', '话费设置'],
        )
        assert_group_items(nav, '财务管理', ['平台明细', '充值记录'])
        assert_group_items(
            nav,
            '系统日志',
            ['接口日志', '回调测试', '异常中心', '操作日志'],
        )

        setup_trigger = nav.get_by_role('button', name='初始管理', exact=True)
        expect(setup_trigger).to_have_attribute('aria-expanded', 'true')
        setup_trigger.click()
        expect(setup_trigger).to_have_attribute('aria-expanded', 'false')
        expect(nav.get_by_role('button', name='字段映射', exact=True)).to_be_hidden()
        setup_trigger.click()
        expect(nav.get_by_role('button', name='字段映射', exact=True)).to_be_visible()

        finance_trigger_desktop = nav.get_by_role(
            'button', name='财务管理', exact=True
        )
        finance_trigger_desktop.click()
        expect(finance_trigger_desktop).to_have_attribute('aria-expanded', 'true')
        expect(setup_trigger).to_have_attribute('aria-expanded', 'false')
        expect(nav.get_by_role('button', name='字段映射', exact=True)).to_be_hidden()
        expect(nav.get_by_role('button', name='平台明细', exact=True)).to_be_visible()
        nav.get_by_role('button', name='平台明细', exact=True).click()
        expect(desktop.get_by_role('heading', name='平台明细', exact=True)).to_be_visible()
        expect(desktop.locator('.topbar')).to_contain_text(
            '运营后台 › 财务管理 › 平台明细'
        )
        expect(
            nav.get_by_role('button', name='财务管理', exact=True)
        ).to_have_attribute('aria-expanded', 'true')
        desktop.screenshot(path=str(DESKTOP_SCREENSHOT), full_page=True)

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(mobile)
        mobile_nav = mobile.get_by_role('navigation', name='平台功能菜单')
        finance_trigger = mobile_nav.get_by_role(
            'button', name='财务管理', exact=True
        )
        expect(finance_trigger).to_have_attribute('aria-expanded', 'false')
        finance_trigger.click()
        expect(finance_trigger).to_have_attribute('aria-expanded', 'true')
        finance_submenu = mobile_nav.get_by_label('财务管理')
        expect(finance_submenu).to_be_visible()
        expect(finance_submenu.get_by_role('button')).to_have_count(2)
        finance_submenu.get_by_role('button', name='平台明细', exact=True).click()
        expect(mobile.get_by_role('heading', name='平台明细', exact=True)).to_be_visible()

        system_trigger = mobile_nav.get_by_role(
            'button', name='系统日志', exact=True
        )
        system_trigger.click()
        expect(finance_submenu).to_be_hidden()
        system_submenu = mobile_nav.get_by_label('系统日志')
        expect(system_submenu).to_be_visible()
        expect(system_submenu.get_by_role('button')).to_have_count(4)
        mobile.screenshot(path=str(MOBILE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Navigation UI verification passed '
        '(desktop groups + collapse + breadcrumb + mobile secondary row)'
    )
    print(f'Desktop screenshot: {DESKTOP_SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
