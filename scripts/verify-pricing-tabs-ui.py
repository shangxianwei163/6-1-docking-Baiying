from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
STUDIO_SCREENSHOT = Path('/tmp/outbound-platform-pricing-studio.png')
HAINAN_SCREENSHOT = Path('/tmp/outbound-platform-pricing-hainan.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-pricing-tabs-mobile.png')


def open_pricing(page):
    page.goto(APP_URL, wait_until='networkidle')
    page.get_by_role('button', name=re.compile(r'^话费设置')).click()
    expect(page.get_by_role('heading', name='话费设置', exact=True)).to_be_visible()
    return (
        page.get_by_role('tab', name=re.compile(r'^影楼话费')),
        page.get_by_role('tab', name=re.compile(r'^海南人像话费')),
    )


def assert_studio_scope(page, studio_tab, hainan_tab) -> None:
    expect(studio_tab).to_have_attribute('aria-selected', 'true')
    expect(hainan_tab).to_have_attribute('aria-selected', 'false')
    expect(page.get_by_text('发布客户价格版本', exact=True)).to_be_visible()
    expect(page.get_by_text('影楼价格版本', exact=True)).to_be_visible()
    expect(page.get_by_text('供应商月度结算', exact=True)).not_to_be_visible()
    expect(
        page.get_by_text('海南人像供应成本阶梯', exact=True)
    ).not_to_be_visible()


def assert_hainan_scope(page, studio_tab, hainan_tab) -> None:
    expect(studio_tab).to_have_attribute('aria-selected', 'false')
    expect(hainan_tab).to_have_attribute('aria-selected', 'true')
    expect(page.get_by_text('发布客户价格版本', exact=True)).not_to_be_visible()
    expect(page.get_by_text('影楼价格版本', exact=True)).not_to_be_visible()
    expect(page.get_by_text('供应商月度结算', exact=True)).to_be_visible()
    expect(page.get_by_text('海南人像供应成本阶梯', exact=True)).to_be_visible()


def assert_internal_scroll(page, panel_id: str) -> None:
    panel = page.locator(f'#{panel_id}')
    metrics = panel.evaluate(
        '''element => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowY: getComputedStyle(element).overflowY,
        })'''
    )
    if metrics['overflowY'] not in {'auto', 'scroll'}:
        raise AssertionError(
            f'{panel_id} is not vertically scrollable: {metrics["overflowY"]}'
        )
    if metrics['scrollHeight'] <= metrics['clientHeight'] + 1:
        raise AssertionError(
            f'{panel_id} has no internal scroll range: '
            f'{metrics["scrollHeight"]}px <= {metrics["clientHeight"]}px'
        )

    tab_list = page.get_by_role('tablist', name='话费设置分类')
    heading = page.get_by_role('heading', name='话费设置', exact=True)
    tab_top = tab_list.bounding_box()['y']
    heading_top = heading.bounding_box()['y']
    panel.hover()
    page.mouse.wheel(0, 700)
    page.wait_for_function(
        'panelId => document.getElementById(panelId).scrollTop > 0',
        arg=panel_id,
    )
    if abs(tab_list.bounding_box()['y'] - tab_top) > 1:
        raise AssertionError('Primary pricing tabs moved with the panel content')
    if abs(heading.bounding_box()['y'] - heading_top) > 1:
        raise AssertionError('Pricing heading moved with the panel content')
    panel.evaluate('element => { element.scrollTop = 0; }')


def main() -> None:
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1327, 'height': 964})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        studio_tab, hainan_tab = open_pricing(page)

        assert_studio_scope(page, studio_tab, hainan_tab)
        assert_internal_scroll(page, 'pricing-panel-studio')
        page.screenshot(path=str(STUDIO_SCREENSHOT), full_page=True)

        hainan_tab.click()
        assert_hainan_scope(page, studio_tab, hainan_tab)
        assert_internal_scroll(page, 'pricing-panel-hainan')
        page.screenshot(path=str(HAINAN_SCREENSHOT), full_page=True)

        hainan_tab.press('ArrowLeft')
        assert_studio_scope(page, studio_tab, hainan_tab)
        expect(studio_tab).to_be_focused()

        studio_tab.press('End')
        assert_hainan_scope(page, studio_tab, hainan_tab)
        expect(hainan_tab).to_be_focused()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        mobile_studio_tab, mobile_hainan_tab = open_pricing(mobile)
        assert_studio_scope(mobile, mobile_studio_tab, mobile_hainan_tab)

        tab_list = mobile.get_by_role('tablist', name='话费设置分类')
        first_box = mobile_studio_tab.bounding_box()
        second_box = mobile_hainan_tab.bounding_box()
        list_box = tab_list.bounding_box()
        if not first_box or not second_box or not list_box:
            raise AssertionError('Unable to measure mobile pricing tabs')
        if second_box['y'] < first_box['y'] + first_box['height']:
            raise AssertionError('Mobile pricing tabs overlap instead of stacking')
        if list_box['x'] < 0 or list_box['x'] + list_box['width'] > 390:
            raise AssertionError('Mobile pricing tab list escapes the viewport')

        mobile_hainan_tab.click()
        assert_hainan_scope(mobile, mobile_studio_tab, mobile_hainan_tab)
        mobile.screenshot(path=str(MOBILE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Pricing tabs UI verification passed '
        '(content separation + internal vertical scrolling + fixed tabs + '
        'click/keyboard switching + mobile layout)'
    )
    print(f'Studio screenshot: {STUDIO_SCREENSHOT}')
    print(f'Hainan screenshot: {HAINAN_SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
