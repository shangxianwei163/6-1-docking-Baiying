from pathlib import Path
import json
import re
from urllib.request import ProxyHandler, Request, build_opener

from playwright.sync_api import expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
API_BASE_URL = 'http://127.0.0.1:8788'
STUDIO_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-studios.png')
LEDGER_PAGE_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-ledger-page.png')
LEDGER_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-ledger.png')
PRICING_SCREENSHOT = Path('/tmp/outbound-platform-stage6b-pricing.png')


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


def api_json(path: str) -> dict:
    opener = build_opener(ProxyHandler({}))
    request = Request(
        f'{API_BASE_URL}{path}',
        headers={'x-actor-id': 'stage6b-ui-verifier'},
    )
    with opener.open(request, timeout=10) as response:
        return json.load(response)['data']


def load_fixtures() -> tuple[dict, list[dict], dict]:
    studio_page = api_json('/api/v1/studios?pageNum=0&pageSize=100')
    pricing = api_json('/api/v1/pricing')
    ledger = api_json('/api/v1/account-ledger?pageNum=0&pageSize=100')
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
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(APP_URL, wait_until='networkidle')

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
        expect(studio_dialog.get_by_text('ERP / CRM 回传端点', exact=True)).to_be_visible()
        studio_dialog.locator('[data-slot="dialog-close"]').click()

        page.get_by_role('button', name=re.compile(r'^新增影楼$')).click()
        create_dialog = page.get_by_role('dialog')
        expect(create_dialog.get_by_text('新增影楼', exact=True)).to_be_visible()
        expect(
            create_dialog.get_by_text(
                '联系人手机号只写入加密字段，列表仅返回脱敏值。', exact=True
            )
        ).to_be_visible()
        create_dialog.locator('[data-slot="dialog-close"]').click()
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
        intro_box = page.locator('.finance-page-intro').bounding_box()
        principle_box = page.locator('.ledger-arrival-principle').bounding_box()
        ledger_panel_box = page.locator('.finance-ledger-panel').bounding_box()
        ledger_table_box = page.locator(
            '.finance-ledger-panel .ops-table-wrap'
        ).bounding_box()
        if not intro_box or intro_box['height'] > 74:
            raise AssertionError(f'Finance page intro is not compact: {intro_box}')
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
        studio_pricing_dialog.get_by_role('button', name='预览发布影响').click()
        preview_dialog = page.get_by_role('dialog')
        expect(preview_dialog.get_by_text('确认价格版本影响', exact=True)).to_be_visible()
        expect(preview_dialog.get_by_text(re.compile(r'1 家影楼'))).to_be_visible()
        expect(
            preview_dialog.get_by_text(first_pricing['name'], exact=True)
        ).to_be_visible()
        page.screenshot(path=str(PRICING_SCREENSHOT), full_page=True)
        preview_dialog.get_by_role('button', name='返回修改').click()
        expect(page.get_by_text('确认价格版本影响', exact=True)).not_to_be_visible()
        expect(page.get_by_role('dialog')).to_contain_text(first_pricing['name'])
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Stage 6B UI verification passed (read-only + pricing preview)')
    print(f'Studio screenshot: {STUDIO_SCREENSHOT}')
    print(f'Ledger page screenshot: {LEDGER_PAGE_SCREENSHOT}')
    print(f'Ledger screenshot: {LEDGER_SCREENSHOT}')
    print(f'Pricing screenshot: {PRICING_SCREENSHOT}')


if __name__ == '__main__':
    main()
