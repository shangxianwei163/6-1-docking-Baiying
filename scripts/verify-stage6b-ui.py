from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright
from ui_auth import APP_URL, authenticated_api_json, open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
STUDIO_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-studios.png')
STUDIO_DETAIL_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-studio-detail.png')
STUDIO_EDITOR_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-studio-editor.png')
LEDGER_PAGE_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-ledger-page.png')
LEDGER_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-ledger.png')
PRICING_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-pricing.png')
API_DOCS_SCREENSHOT = Path('/tmp/outbound-platform-simple-token-api-docs.png')


def assert_dialog_has_no_overflow(dialog, label: str) -> None:
    metrics = dialog.evaluate(
        '''element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowX: getComputedStyle(element).overflowX,
            overflowY: getComputedStyle(element).overflowY,
        })'''
    )
    if metrics['overflowX'] != 'hidden' or metrics['overflowY'] != 'hidden':
        raise AssertionError(f'{label} allows scrolling: {metrics}')
    if metrics['scrollWidth'] > metrics['clientWidth'] + 1:
        raise AssertionError(f'{label} clips horizontally: {metrics}')
    if metrics['scrollHeight'] > metrics['clientHeight'] + 1:
        raise AssertionError(f'{label} clips vertically: {metrics}')


def load_fixtures() -> tuple[dict, list[dict], dict]:
    studio_page = authenticated_api_json(
        '/api/v1/studios?pageNum=0&pageSize=100'
    )
    pricing = authenticated_api_json('/api/v1/pricing')
    ledger = authenticated_api_json(
        '/api/v1/account-ledger?pageNum=0&pageSize=100'
    )
    if not studio_page['studios']:
        raise AssertionError('Stage 6B UI verification needs at least one studio')
    if not pricing['studios']:
        raise AssertionError('Stage 6B UI verification needs studio pricing data')
    if not pricing['supplierTiers']:
        raise AssertionError('Stage 6B UI verification needs supplier pricing tiers')
    return studio_page['studios'][0], ledger['items'], pricing


def main() -> None:
    studio, ledger_items, pricing = load_fixtures()
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        context = browser.new_context(
            viewport={'width': 1600, 'height': 1000},
            permissions=['clipboard-read', 'clipboard-write'],
        )
        page = context.new_page()
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(page)

        page.get_by_role('button', name=re.compile(r'^影楼管理')).click()
        expect(page.get_by_text('PostgreSQL 实时数据')).to_be_visible()
        studio_row = page.locator('tr', has_text=studio['businessCode'])
        expect(studio_row.get_by_text(studio['name'], exact=True)).to_be_visible()
        expect(studio_row).to_contain_text(studio['mcCode'])
        studio_row.get_by_role(
            'button', name=f"查看 {studio['name']} 详情"
        ).click()
        studio_dialog = page.get_by_role('dialog')
        expect(studio_dialog.get_by_text(studio['name'], exact=True)).to_be_visible()
        expect(studio_dialog.get_by_text('可用余额', exact=True)).to_be_visible()
        expect(
            studio_dialog.get_by_text('ERP / CRM 请求 Token', exact=True)
        ).to_be_visible()
        if not studio['requestTokens']:
            raise AssertionError('Studio detail must expose ERP/CRM request tokens')
        for item in studio['requestTokens']:
            token_row = studio_dialog.locator(
                '.ops-token-list article', has_text=item['clientId']
            )
            expect(token_row.get_by_text(item['token'], exact=True)).to_be_visible()
        first_token = studio['requestTokens'][0]
        first_token_row = studio_dialog.locator(
            '.ops-token-list article', has_text=first_token['clientId']
        )
        first_token_row.get_by_role('button', name='复制 Token').click()
        expect(first_token_row.get_by_role('button', name='已复制')).to_be_visible()
        if page.evaluate('navigator.clipboard.readText()') != first_token['token']:
            raise AssertionError('Request token copy button copied the wrong value')
        expect(studio_dialog.get_by_text('ERP / CRM 回传端点', exact=True)).to_be_visible()
        assert_dialog_has_no_overflow(studio_dialog, 'Studio detail dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_overflow(
            studio_dialog, 'Studio detail dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        page.screenshot(path=str(STUDIO_DETAIL_SCREENSHOT), full_page=True)
        studio_dialog.locator('[data-slot="dialog-close"]').click()

        page.get_by_role('button', name=re.compile(r'^新增影楼$')).click()
        create_dialog = page.get_by_role('dialog')
        expect(create_dialog.get_by_text('新增影楼', exact=True)).to_be_visible()
        expect(
            create_dialog.get_by_text(
                '联系人手机号只写入加密字段，列表仅返回脱敏值。', exact=True
            )
        ).to_be_visible()
        for label in [
            'ERP 结果回传地址',
            'ERP 录音回传地址',
            'CRM 结果回传地址',
            'CRM 录音回传地址',
        ]:
            expect(create_dialog.get_by_label(label, exact=True)).to_be_visible()
        assert_dialog_has_no_overflow(create_dialog, 'Studio editor dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_overflow(
            create_dialog, 'Studio editor dialog at short viewport'
        )
        page.set_viewport_size({'width': 390, 'height': 844})
        assert_dialog_has_no_overflow(
            create_dialog, 'Studio editor dialog at mobile viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        create_dialog.locator('[data-slot="dialog-close"]').click()

        studio_row.get_by_role('button', name=f"编辑 {studio['name']}").click()
        edit_dialog = page.get_by_role('dialog')
        expect(edit_dialog.get_by_text('编辑影楼资料', exact=True)).to_be_visible()
        for source, result_label, recording_label in [
            ('ERP', 'ERP 结果回传地址', 'ERP 录音回传地址'),
            ('CRM', 'CRM 结果回传地址', 'CRM 录音回传地址'),
        ]:
            endpoints = [
                endpoint
                for endpoint in studio['endpoints']
                if endpoint['sourceSystem'] == source
            ]
            if endpoints:
                latest = max(endpoints, key=lambda endpoint: endpoint['version'])
                expect(edit_dialog.get_by_label(result_label, exact=True)).to_have_value(
                    latest['resultUrl']
                )
                expect(
                    edit_dialog.get_by_label(recording_label, exact=True)
                ).to_have_value(latest['recordingUrl'])
        assert_dialog_has_no_overflow(edit_dialog, 'Studio edit dialog')
        page.screenshot(path=str(STUDIO_EDITOR_SCREENSHOT), full_page=True)
        edit_dialog.locator('[data-slot="dialog-close"]').click()
        page.screenshot(path=str(STUDIO_SCREENSHOT), full_page=True)

        page.get_by_role('button', name=re.compile(r'^充值记录')).click()
        ledger_tab = page.get_by_role('tab', name=re.compile(r'^真实账户流水'))
        adjustment_tab = page.get_by_role(
            'tab', name=re.compile(r'^退款与人工调整审批')
        )
        expect(ledger_tab).to_have_attribute('aria-selected', 'true')
        expect(adjustment_tab).to_have_attribute('aria-selected', 'false')
        expect(page.locator('#finance-panel-ledger')).to_be_visible()
        expect(page.locator('#finance-panel-adjustments')).not_to_be_attached()
        page.set_viewport_size({'width': 1327, 'height': 964})
        principle_box = page.locator('.finance-policy-principle').bounding_box()
        ledger_panel_box = page.locator('.finance-ledger-panel').bounding_box()
        ledger_table_box = page.locator(
            '.finance-ledger-panel .ops-table-wrap'
        ).bounding_box()
        if not principle_box or not ledger_panel_box:
            raise AssertionError('Ledger principle or ledger panel is missing')
        if principle_box['y'] + principle_box['height'] > ledger_panel_box['y']:
            raise AssertionError('Arrival principle must appear above the ledger panel')
        if not ledger_table_box or ledger_table_box['height'] < 360:
            raise AssertionError(f'Ledger table area is too short: {ledger_table_box}')
        if ledger_items:
            first_entry = ledger_items[0]
            ledger_row = page.locator('tr', has_text=first_entry['businessKey'])
            expect(
                ledger_row.get_by_text(first_entry['studioName'], exact=True)
            ).to_be_visible()
        else:
            expect(page.get_by_text('没有符合条件的账本流水')).to_be_visible()
        page.screenshot(path=str(LEDGER_PAGE_SCREENSHOT), full_page=True)
        page.set_viewport_size({'width': 1600, 'height': 1000})
        page.get_by_role('button', name='登记线下充值').click()
        top_up_dialog = page.get_by_role('dialog')
        expect(top_up_dialog.get_by_text('登记线下充值', exact=True)).to_be_visible()
        expect(
            top_up_dialog.get_by_text(
                re.compile(r'当前只保存凭证编号和文件名元数据')
            )
        ).to_be_visible()
        assert_dialog_has_no_overflow(top_up_dialog, 'Top-up dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_overflow(top_up_dialog, 'Top-up dialog at short viewport')
        page.set_viewport_size({'width': 1600, 'height': 1000})
        page.screenshot(path=str(LEDGER_SCREENSHOT), full_page=True)
        top_up_dialog.get_by_role('button', name='取消').click()
        expect(top_up_dialog).not_to_be_visible()

        page.get_by_role('button', name=re.compile(r'^话费设置')).click()
        expect(page.get_by_text('影楼价格版本', exact=True)).to_be_visible()
        first_pricing = pricing['studios'][0]
        pricing_row = page.locator('tr', has_text=first_pricing['businessCode'])
        expect(
            pricing_row.get_by_text(first_pricing['name'], exact=True)
        ).to_be_visible()
        first_tier = pricing['supplierTiers'][0]
        page.get_by_role('tab', name=re.compile(r'^海南人像话费')).click()
        expect(page.get_by_text(first_tier['tierCode'], exact=True)).to_be_visible()
        page.get_by_role('tab', name=re.compile(r'^影楼话费')).click()

        pricing_row.get_by_role('button', name='单独调价').click()
        studio_pricing_dialog = page.get_by_role('dialog')
        expect(studio_pricing_dialog).to_contain_text(first_pricing['name'])
        assert_dialog_has_no_overflow(
            studio_pricing_dialog, 'Studio pricing dialog'
        )
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_overflow(
            studio_pricing_dialog, 'Studio pricing dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        studio_pricing_dialog.get_by_role('button', name='预览发布影响').click()
        preview_dialog = page.get_by_role('dialog')
        expect(preview_dialog.get_by_text('确认价格版本影响', exact=True)).to_be_visible()
        expect(preview_dialog.get_by_text(re.compile(r'1 家影楼'))).to_be_visible()
        expect(
            preview_dialog.get_by_text(first_pricing['name'], exact=True)
        ).to_be_visible()
        assert_dialog_has_no_overflow(preview_dialog, 'Price preview dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_overflow(
            preview_dialog, 'Price preview dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        page.screenshot(path=str(PRICING_SCREENSHOT), full_page=True)
        preview_dialog.get_by_role('button', name='返回修改').click()
        expect(page.get_by_text('确认价格版本影响', exact=True)).not_to_be_visible()
        expect(page.get_by_role('dialog')).to_contain_text(first_pricing['name'])

        docs_page = context.new_page()
        docs_page.goto(
            f"{APP_URL.rstrip('/')}/api-docs?api=create-outbound-task",
            wait_until='networkidle',
        )
        expect(docs_page.locator('body')).to_contain_text(
            'X-Access-Token 固定 Token'
        )
        expect(docs_page.get_by_text('X-Access-Token', exact=True)).to_be_visible()
        expect(docs_page.get_by_text('X-Client-Id', exact=True)).to_have_count(0)
        expect(docs_page.get_by_text('X-Nonce', exact=True)).to_have_count(0)
        docs_page.screenshot(path=str(API_DOCS_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Stage 6B UI verification passed (read-only + pricing preview)')
    print(f'Studio screenshot: {STUDIO_SCREENSHOT}')
    print(f'Studio detail screenshot: {STUDIO_DETAIL_SCREENSHOT}')
    print(f'Studio editor screenshot: {STUDIO_EDITOR_SCREENSHOT}')
    print(f'Ledger page screenshot: {LEDGER_PAGE_SCREENSHOT}')
    print(f'Ledger screenshot: {LEDGER_SCREENSHOT}')
    print(f'Pricing screenshot: {PRICING_SCREENSHOT}')
    print(f'API docs screenshot: {API_DOCS_SCREENSHOT}')


if __name__ == '__main__':
    main()
