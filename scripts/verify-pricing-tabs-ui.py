from pathlib import Path
import json
import re

from playwright.sync_api import Route, expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
STUDIO_SCREENSHOT = Path('/tmp/outbound-platform-pricing-studio.png')
STUDIO_EDITOR_SCREENSHOT = Path('/tmp/outbound-platform-studio-pricing-editor.png')
MONTH_PICKER_SCREENSHOT = Path('/tmp/outbound-platform-month-picker.png')
HAINAN_SCREENSHOT = Path('/tmp/outbound-platform-pricing-hainan.png')
HAINAN_TIERS_SCREENSHOT = Path('/tmp/outbound-platform-pricing-hainan-tiers.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-pricing-tabs-mobile.png')
EDITOR_SCREENSHOT = Path('/tmp/outbound-platform-supplier-pricing-editor.png')
EDITOR_FORM_SCREENSHOT = Path('/tmp/outbound-platform-supplier-pricing-form.png')
EDITOR_SHORT_SCREENSHOT = Path('/tmp/outbound-platform-supplier-pricing-short.png')
EDITOR_VALIDATION_SCREENSHOT = Path(
    '/tmp/outbound-platform-supplier-pricing-validation.png'
)


def install_supplier_pricing_fixture(page, requests: list[dict]) -> None:
    def handle(route: Route) -> None:
        request = route.request
        payload = request.post_data_json
        requests.append({'path': request.url.rsplit('/', 1)[-1], 'body': payload})
        if request.url.endswith('/preview'):
            data = {
                'effectiveFrom': payload['effectiveFrom'],
                'tierCount': len(payload['tiers']),
                'currentEffectiveFrom': '2026-08-31T16:00:00.000Z',
                'replacesScheduledEffectiveFrom': None,
                'tiers': payload['tiers'],
            }
            status = 200
        else:
            data = {
                'effectiveFrom': payload['effectiveFrom'],
                'replacedScheduledCount': 0,
                'published': [
                    {
                        **tier,
                        'id': f'00000000-0000-4000-8000-{index + 1:012d}',
                        'effectiveFrom': payload['effectiveFrom'],
                        'effectiveTo': None,
                        'publishedBy': 'platform-admin',
                        'publishedAt': '2026-09-07T03:00:00.000Z',
                    }
                    for index, tier in enumerate(payload['tiers'])
                ],
            }
            status = 201
        route.fulfill(
            status=status,
            content_type='application/json',
            body=json.dumps({'requestId': 'supplier-pricing-ui-test', 'data': data}),
        )

    page.route(re.compile(r'.*/api/v1/supplier-pricing/(?:preview|publish)$'), handle)


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


def assert_single_studio_editor(page) -> None:
    page.get_by_role('tab', name=re.compile(r'^单影楼价格')).click()
    expect(
        page.get_by_text('在下方影楼列表中选择要调整的客户', exact=True)
    ).to_be_visible()
    expect(page.get_by_label('客户话费单价')).not_to_be_visible()
    expect(page.get_by_text('影楼价格版本', exact=True)).to_be_visible()
    page.get_by_role('button', name='单独调价').first.click()
    dialog = page.get_by_role('dialog')
    expect(
        dialog.get_by_role('heading', name=re.compile(r'^单独调整'))
    ).to_be_visible()
    expect(dialog.get_by_label('单影楼客户话费单价')).to_be_visible()
    expect(dialog.get_by_label('单影楼客户短信单价')).to_be_visible()
    expect(dialog.get_by_label('单影楼每号码冻结分钟')).to_be_visible()
    page.screenshot(path=str(STUDIO_EDITOR_SCREENSHOT), full_page=True)
    dialog.get_by_role('button', name='取消').click()
    expect(dialog).not_to_be_visible()


def assert_hainan_scope(page, studio_tab, hainan_tab) -> None:
    panel = page.locator('#pricing-panel-hainan')
    expect(studio_tab).to_have_attribute('aria-selected', 'false')
    expect(hainan_tab).to_have_attribute('aria-selected', 'true')
    expect(page.get_by_text('发布客户价格版本', exact=True)).not_to_be_visible()
    expect(page.get_by_text('影楼价格版本', exact=True)).not_to_be_visible()
    expect(page.get_by_text('供应商月度结算', exact=True)).to_be_visible()
    expect(page.get_by_text('海南人像供应成本阶梯', exact=True)).to_be_visible()
    expect(
        page.get_by_role('columnheader', name='月度用量范围（万分钟）')
    ).to_be_visible()
    expect(panel.get_by_text('0（含）— 1（不含）', exact=True)).to_have_count(1)
    expect(panel.get_by_text('1（含）— 5（不含）', exact=True)).to_have_count(1)
    expect(panel.get_by_text('≥ 5', exact=True)).to_have_count(1)
    expect(panel.get_by_text('5（含）— 6（不含）', exact=True)).to_have_count(1)
    expect(panel.get_by_text('≥ 6', exact=True)).to_have_count(1)
    tier_rows = panel.locator('.ops-tier-table tbody tr')
    expect(tier_rows).to_have_count(4)
    expect(panel.locator('.ops-tier-table .status-green')).to_have_count(3)
    expect(panel.locator('.ops-tier-table .status-blue')).to_have_count(2)
    expect(panel.get_by_text('系统初始化导入', exact=True)).to_have_count(3)
    expect(panel.get_by_text('平台管理员', exact=True)).to_have_count(2)
    expect(panel.get_by_text('历史配置迁移', exact=True)).to_have_count(3)
    expect(panel.get_by_text('运营后台发布', exact=True)).to_have_count(2)
    range_cells = tier_rows.locator('td:nth-child(3)').all_inner_texts()
    voice_cells = tier_rows.locator('td:nth-child(4)').all_inner_texts()
    if len(range_cells) != len(set(range_cells)):
        raise AssertionError(f'Duplicate supplier range values rendered: {range_cells}')
    if len(voice_cells) != len(set(voice_cells)):
        raise AssertionError(f'Duplicate supplier voice rates rendered: {voice_cells}')


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


def assert_dialog_footer_fully_visible(page, dialog) -> None:
    footer = dialog.locator('[data-slot="dialog-footer"]')
    dialog_box = dialog.bounding_box()
    footer_box = footer.bounding_box()
    viewport = page.viewport_size
    if not dialog_box or not footer_box or not viewport:
        raise AssertionError('Unable to measure the supplier pricing dialog footer')

    dialog_bottom = dialog_box['y'] + dialog_box['height']
    footer_bottom = footer_box['y'] + footer_box['height']
    if footer_box['y'] < dialog_box['y'] or footer_bottom > dialog_bottom + 1:
        raise AssertionError(
            f'Dialog footer is clipped by the dialog: {footer_box=} {dialog_box=}'
        )
    if footer_bottom > viewport['height'] - 4:
        dialog_styles = dialog.evaluate(
            '''element => ({
                top: getComputedStyle(element).top,
                maxHeight: getComputedStyle(element).maxHeight,
                transform: getComputedStyle(element).transform,
                height: getComputedStyle(element).height,
            })'''
        )
        raise AssertionError(
            f'Dialog footer escapes the viewport: {footer_bottom}px > '
            f'{viewport["height"] - 4}px; {dialog_box=} {footer_box=} '
            f'{dialog_styles=}'
        )

    for label in ['取消', '预览发布影响']:
        button_box = dialog.get_by_role('button', name=label).bounding_box()
        if not button_box:
            raise AssertionError(f'Unable to measure dialog button: {label}')
        button_bottom = button_box['y'] + button_box['height']
        if button_box['y'] < footer_box['y'] or button_bottom > footer_bottom - 4:
            raise AssertionError(
                f'Dialog button is clipped inside the footer: {label} {button_box=}'
            )


def ten_thousands_to_minutes(value: str) -> str:
    whole, separator, decimal = value.partition('.')
    fraction = decimal.ljust(4, '0') if separator else '0000'
    return str(int(whole) * 10_000 + int(fraction))


def main() -> None:
    page_errors: list[str] = []
    supplier_pricing_requests: list[dict] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1327, 'height': 964})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        install_supplier_pricing_fixture(page, supplier_pricing_requests)
        studio_tab, hainan_tab = open_pricing(page)

        assert_studio_scope(page, studio_tab, hainan_tab)
        assert_single_studio_editor(page)
        assert_internal_scroll(page, 'pricing-panel-studio')
        page.screenshot(path=str(STUDIO_SCREENSHOT), full_page=True)

        hainan_tab.click()
        assert_hainan_scope(page, studio_tab, hainan_tab)
        month_picker = page.get_by_label('供应商结算月份')
        expect(month_picker).to_have_class(re.compile(r'unified-date-trigger'))
        month_picker.click()
        expect(page.get_by_text('选择结算月份', exact=True)).to_be_visible()
        expect(page.locator('.unified-month-grid')).to_be_visible()
        page.screenshot(path=str(MONTH_PICKER_SCREENSHOT), full_page=True)
        page.keyboard.press('Escape')
        assert_internal_scroll(page, 'pricing-panel-hainan')
        page.screenshot(path=str(HAINAN_SCREENSHOT), full_page=True)
        hainan_panel = page.locator('#pricing-panel-hainan')
        hainan_panel.evaluate('element => { element.scrollTop = element.scrollHeight; }')
        page.screenshot(path=str(HAINAN_TIERS_SCREENSHOT), full_page=True)
        hainan_panel.evaluate('element => { element.scrollTop = 0; }')

        page.get_by_role(
            'button', name=re.compile(r'^(?:维护供应价格|修改预约价格)$')
        ).click()
        dialog = page.get_by_role('dialog')
        expect(
            dialog.get_by_role('heading', name='维护海南人像供应价格')
        ).to_be_visible()
        expect(dialog.get_by_label('第 1 档话费')).to_have_value('0.2')
        expect(dialog.get_by_label('第 1 档用量下限（万分钟）')).to_have_value(
            '0'
        )
        expect(dialog.get_by_label('第 1 档用量上限（万分钟）')).to_have_value(
            '1'
        )
        expect(dialog.get_by_label('第 2 档用量下限（万分钟）')).to_have_value(
            '1'
        )
        expect(dialog.get_by_label('第 2 档用量上限（万分钟）')).to_have_value(
            '5'
        )
        baseline_tier_count = dialog.locator(
            '.supplier-tier-editor-list article'
        ).count()
        expected_ranges = []
        for tier_number in range(1, baseline_tier_count + 1):
            minimum = dialog.get_by_label(
                f'第 {tier_number} 档用量下限（万分钟）'
            ).input_value()
            maximum = dialog.get_by_label(
                f'第 {tier_number} 档用量上限（万分钟）'
            ).input_value()
            expected_ranges.append(
                (
                    ten_thousands_to_minutes(minimum),
                    ten_thousands_to_minutes(maximum) if maximum else None,
                )
            )

        dialog.get_by_role('button', name='新增阶梯').click()
        added_tier_number = baseline_tier_count + 1
        expect(
            dialog.get_by_text(
                f'第 {added_tier_number} 档「用量下限」填写不正确',
                exact=True,
            )
        ).to_be_visible()
        expect(
            dialog.get_by_text(
                '请输入 0 或正数，最多 4 位小数，例如 5（表示 5 万分钟）。',
                exact=True,
            )
        ).to_be_visible()
        invalid_minimum = dialog.get_by_label(
            f'第 {added_tier_number} 档用量下限（万分钟）'
        )
        expect(invalid_minimum).to_have_attribute('aria-invalid', 'true')
        expect(dialog.get_by_text(re.compile(r'Invalid string'))).not_to_be_visible()
        dialog.get_by_role('button', name='预览发布影响').click()
        expect(invalid_minimum).to_be_focused()
        page.screenshot(path=str(EDITOR_VALIDATION_SCREENSHOT), full_page=True)
        dialog.get_by_role(
            'button', name=f'删除第 {added_tier_number} 档'
        ).click()
        dialog.get_by_label('第 1 档话费').fill('0.21')
        assert_dialog_footer_fully_visible(page, dialog)
        page.screenshot(path=str(EDITOR_FORM_SCREENSHOT), full_page=True)

        page.set_viewport_size({'width': 1024, 'height': 640})
        page.evaluate(
            '''() => new Promise(resolve => requestAnimationFrame(
                () => requestAnimationFrame(resolve)
            ))'''
        )
        page.wait_for_timeout(150)
        assert_dialog_footer_fully_visible(page, dialog)
        page.screenshot(path=str(EDITOR_SHORT_SCREENSHOT), full_page=True)
        page.set_viewport_size({'width': 1327, 'height': 964})
        assert_dialog_footer_fully_visible(page, dialog)

        dialog.get_by_role('button', name='预览发布影响').click()
        expect(
            dialog.get_by_role('heading', name='确认供应价格版本')
        ).to_be_visible()
        expect(
            dialog.get_by_role('columnheader', name='月度用量范围（万分钟）')
        ).to_be_visible()
        expect(dialog.get_by_text('0（含）— 1（不含）', exact=True)).to_be_visible()
        expect(dialog.get_by_text('¥0.21 / 分钟', exact=True)).to_be_visible()
        page.screenshot(path=str(EDITOR_SCREENSHOT), full_page=True)
        dialog.get_by_role('button', name='确认发布新版本').click()
        expect(dialog).not_to_be_visible()
        expect(page.get_by_text(re.compile(r'海南人像供应价格已预约'))).to_be_visible()

        if [item['path'] for item in supplier_pricing_requests] != [
            'preview',
            'publish',
        ]:
            raise AssertionError(
                f'Unexpected supplier pricing requests: {supplier_pricing_requests}'
            )
        preview_body = supplier_pricing_requests[0]['body']
        publish_body = supplier_pricing_requests[1]['body']
        if preview_body != publish_body:
            raise AssertionError('Published supplier pricing differs from preview')
        if len(publish_body['tiers']) != baseline_tier_count:
            raise AssertionError('Supplier pricing publication was not a complete tier set')
        if publish_body['tiers'][0]['voiceRate'] != '0.21':
            raise AssertionError('Edited supplier voice rate was not published')
        actual_ranges = [
            (tier['minMonthlyMinutes'], tier['maxMonthlyMinutes'])
            for tier in publish_body['tiers']
        ]
        if actual_ranges != expected_ranges:
            raise AssertionError(
                'Ten-thousand-minute inputs were not converted back to exact minutes: '
                f'{actual_ranges}'
            )

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
        'click/keyboard switching + merged version comparisons without repeated '
        'range/rate values + readable publisher labels + ten-thousand-minute '
        'display/input conversion + localized validation + fully visible dialog '
        'footer + mobile layout)'
    )
    print(f'Studio screenshot: {STUDIO_SCREENSHOT}')
    print(f'Studio editor screenshot: {STUDIO_EDITOR_SCREENSHOT}')
    print(f'Month picker screenshot: {MONTH_PICKER_SCREENSHOT}')
    print(f'Hainan screenshot: {HAINAN_SCREENSHOT}')
    print(f'Hainan tier table screenshot: {HAINAN_TIERS_SCREENSHOT}')
    print(f'Supplier pricing editor screenshot: {EDITOR_SCREENSHOT}')
    print(f'Supplier pricing form screenshot: {EDITOR_FORM_SCREENSHOT}')
    print(f'Supplier pricing short viewport screenshot: {EDITOR_SHORT_SCREENSHOT}')
    print(f'Supplier pricing validation screenshot: {EDITOR_VALIDATION_SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
