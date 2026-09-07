from pathlib import Path
import re
import json
from urllib.request import ProxyHandler, Request, build_opener

from playwright.sync_api import expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow


SCREENSHOT = Path('/tmp/outbound-platform-stage6-task.png')
LIST_SCREENSHOT = Path('/tmp/outbound-platform-stage6-list.png')
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
API_BASE_URL = 'http://127.0.0.1:8788'


def api_json(path: str) -> dict:
    opener = build_opener(ProxyHandler({}))
    request = Request(
        f'{API_BASE_URL}{path}',
        headers={'x-actor-id': 'stage6-ui-verifier'},
    )
    with opener.open(request, timeout=10) as response:
        return json.load(response)['data']


def find_fixtures() -> tuple[dict, dict, dict]:
    tasks = api_json('/api/v1/outbound-tasks?pageNum=0&pageSize=100')['tasks']
    delivery_pending = next(
        (
            task
            for task in tasks
            if task['statuses']['execution'] == 'COMPLETED'
            and task['statuses']['display'] == '执行中'
            and task['counts']['callInstances'] > 0
        ),
        None,
    )
    calling = next(
        (
            task
            for task in tasks
            if task['statuses']['display'] == '呼叫中'
        ),
        None,
    )
    if not delivery_pending or not calling:
        raise AssertionError(
            'Stage 6A UI verification needs one delivery-pending and one calling local task'
        )
    calls = api_json(
        f"/api/v1/outbound-tasks/{delivery_pending['taskNo']}/calls?limit=50"
    )['items']
    if not calls:
        raise AssertionError('The delivery-pending Stage 6A fixture has no call detail')
    return delivery_pending, calling, calls[0]


def main() -> None:
    delivery_pending_task, calling_task, completed_call = find_fixtures()
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto('http://localhost:4173/', wait_until='networkidle')

        page.get_by_role('button', name=re.compile(r'^呼叫任务')).click()
        expect(page.get_by_text('PostgreSQL 实时数据')).to_be_visible()
        expect(
            page.get_by_role('columnheader', name='任务名称', exact=True)
        ).to_be_visible()
        expect(
            page.get_by_role('columnheader', name='话术 / 线路', exact=True)
        ).to_be_visible()
        expect(
            page.get_by_role('cell', name=delivery_pending_task['taskNo'])
        ).to_be_visible()
        expect(page.get_by_role('cell', name=calling_task['taskNo'])).to_be_visible()
        page.screenshot(path=str(LIST_SCREENSHOT), full_page=True)

        delivery_pending_row = page.locator(
            'tr', has_text=delivery_pending_task['taskNo']
        )
        expect(
            delivery_pending_row.get_by_text('执行中', exact=True)
        ).to_be_visible()
        expect(
            delivery_pending_row.get_by_text('等待业务回传', exact=True)
        ).to_be_visible()
        expect(
            delivery_pending_row.get_by_text(
                delivery_pending_task['taskName'], exact=True
            )
        ).to_be_visible()
        expect(
            delivery_pending_row.get_by_text(
                delivery_pending_task['script']['name'], exact=True
            )
        ).to_be_visible()
        expect(
            delivery_pending_row.get_by_text(
                delivery_pending_task['line']['name'], exact=True
            )
        ).to_be_visible()
        calling_row = page.locator('tr', has_text=calling_task['taskNo'])
        expect(calling_row.get_by_text('呼叫中', exact=True)).to_be_visible()
        expected_charge = (
            f"¥{float(delivery_pending_task['billing']['customerCharge']):,.2f}"
        )
        expect(
            delivery_pending_row.get_by_text(expected_charge, exact=True)
        ).to_be_visible()
        delivery_pending_row.get_by_role('button', name='查看详情').click()

        dialog = page.get_by_role('dialog')
        expect(
            dialog.get_by_text(delivery_pending_task['taskName'], exact=True)
        ).to_be_visible()
        expect(dialog.get_by_text('当前可用余额', exact=True)).to_be_visible()
        dialog.get_by_role('tab', name=re.compile(r'^通话明细')).click()
        expect(dialog.get_by_text(completed_call['phoneMasked'], exact=True)).to_be_visible()
        expect(
            dialog.get_by_text(f"{completed_call['billingMinutes']} 分钟", exact=True)
        ).to_be_visible()
        expect(
            dialog.get_by_text(completed_call['baiyingCallInstanceId'], exact=True)
        ).to_be_visible()
        assert_dialog_has_no_outer_overflow(page, dialog, 'Task detail dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_outer_overflow(
            page, dialog, 'Task detail dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        dialog.locator('[data-slot="dialog-close"]').click()

        task_tabs = page.locator('.real-task-tabs')
        task_tabs.get_by_role('button', name=re.compile(r'^呼叫中')).click()
        expect(page.get_by_role('cell', name=calling_task['taskNo'])).to_be_visible()
        expect(
            page.get_by_role('cell', name=delivery_pending_task['taskNo'])
        ).not_to_be_visible()

        task_tabs.get_by_role('button', name=re.compile(r'^执行中')).click()
        expect(
            page.get_by_role('cell', name=delivery_pending_task['taskNo'])
        ).to_be_visible()
        expect(page.get_by_role('cell', name=calling_task['taskNo'])).not_to_be_visible()
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Stage 6A UI verification passed')
    print(f'List screenshot: {LIST_SCREENSHOT}')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
