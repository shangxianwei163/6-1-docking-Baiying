from copy import deepcopy
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow
from ui_auth import authenticated_api_json, open_authenticated


SCREENSHOT = Path('/tmp/outbound-platform-stage6-task.png')
LIST_SCREENSHOT = Path('/tmp/outbound-platform-stage6-list.png')
SCROLL_SCREENSHOT = Path('/tmp/outbound-platform-stage6-scroll.png')
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
FINISH_STATUS_LABELS = {
    0: '已接通',
    1: '客户拒接',
    2: '无法接通',
    3: '外呼失败',
    4: '空号',
    5: '已关机',
    6: '客户占线',
    7: '号码停机',
    8: '无人接听',
    9: '主叫欠费',
    10: '呼损',
    11: '号码在黑名单中',
    12: '天盾拦截',
    22: '线路盲区',
    23: '呼出拦截',
    25: '无可用线路',
}


def find_fixtures() -> tuple[dict, dict, dict, dict]:
    task_page = authenticated_api_json(
        '/api/v1/outbound-tasks?pageNum=0&pageSize=100'
    )
    tasks = task_page['tasks']
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
    calls = authenticated_api_json(
        f"/api/v1/outbound-tasks/{delivery_pending['taskNo']}/calls?limit=50"
    )['items']
    if not calls:
        raise AssertionError('The delivery-pending Stage 6A fixture has no call detail')
    return delivery_pending, calling, calls[0], task_page


def mock_paginated_tasks(route, template: dict) -> None:
    query = parse_qs(urlparse(route.request.url).query)
    page_num = int(query.get('pageNum', ['0'])[0])
    page_size = int(query.get('pageSize', ['20'])[0])
    total = 75
    start = page_num * page_size
    stop = min(start + page_size, total)
    tasks = []
    for index in range(start, stop):
        task = deepcopy(template)
        task['taskId'] = f'aaaaaaaa-aaaa-4aaa-8aaa-{index + 1:012d}'
        task['taskNo'] = f'PT-20260918-{index + 1:05d}'
        task['taskName'] = f'滚动与分页验收任务-{index + 1:03d}'
        tasks.append(task)
    route.fulfill(
        status=200,
        json={
            'requestId': 'scroll-layout-verification',
            'data': {
                'total': total,
                'pages': (total + page_size - 1) // page_size,
                'pageNum': page_num,
                'pageSize': page_size,
                'statusCounts': {
                    'all': total,
                    'running': total,
                    'calling': 0,
                    'completed': 0,
                    'failed': 0,
                },
                'tasks': tasks,
            },
        },
    )


def verify_scroll_and_page_size(browser, template: dict, page_errors: list[str]) -> None:
    page = browser.new_page(viewport={'width': 1327, 'height': 964})
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.route(
        re.compile(r'.*/api/v1/outbound-tasks\?.*'),
        lambda route: mock_paginated_tasks(route, template),
    )
    open_authenticated(page)
    page.get_by_role('button', name=re.compile(r'^呼叫任务')).click()

    rows = page.locator('.real-task-table tbody tr')
    pagination = page.locator('.real-task-pagination')
    viewport = page.locator('.real-task-table-wrap')
    expect(rows).to_have_count(20)
    expect(pagination).to_contain_text('当前显示 20 条 · 每页 20 条')
    expect(pagination).to_be_visible()

    dimensions = viewport.evaluate(
        '(element) => ({ clientHeight: element.clientHeight, '
        'scrollHeight: element.scrollHeight })'
    )
    if dimensions['scrollHeight'] <= dimensions['clientHeight']:
        raise AssertionError('Twenty task rows must scroll inside the task viewport')
    viewport.evaluate('(element) => { element.scrollTop = element.scrollHeight; }')
    if viewport.evaluate('(element) => element.scrollTop') <= 0:
        raise AssertionError('Task viewport did not retain vertical scroll position')
    if page.locator('.real-task-table th').first.evaluate(
        '(element) => getComputedStyle(element).position'
    ) != 'sticky':
        raise AssertionError('Task table header must remain sticky while scrolling')

    pagination_box = pagination.bounding_box()
    if not pagination_box or pagination_box['y'] + pagination_box['height'] > 964:
        raise AssertionError('Task pagination must remain visible below the scroll area')

    page.get_by_role('button', name='真实任务每页数量').click()
    page.get_by_role('button', name='50 条 / 页', exact=True).click()
    expect(rows).to_have_count(50)
    expect(pagination).to_contain_text('当前显示 50 条 · 每页 50 条')
    if viewport.evaluate('(element) => element.scrollTop') != 0:
        raise AssertionError('Changing page size must reset the list to the top')

    page.screenshot(path=str(SCROLL_SCREENSHOT), full_page=True)
    page.close()


def main() -> None:
    delivery_pending_task, calling_task, completed_call, task_page = find_fixtures()
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(page)

        page.get_by_role('button', name=re.compile(r'^呼叫任务')).click()
        expect(page.get_by_text('PostgreSQL 实时数据')).to_be_visible()
        expect(
            page.get_by_role('columnheader', name='任务名称', exact=True)
        ).to_be_visible()
        expect(
            page.get_by_role('columnheader', name='话术 / 线路', exact=True)
        ).to_be_visible()
        task_rows = page.locator('.real-task-table tbody tr')
        expected_default_count = min(task_page['total'], 20)
        expect(task_rows).to_have_count(expected_default_count)
        pagination = page.locator('.real-task-pagination')
        expect(pagination).to_contain_text(
            f'当前显示 {expected_default_count} 条 · 每页 20 条'
        )
        expect(pagination).to_be_visible()
        pagination_box = pagination.bounding_box()
        if not pagination_box or pagination_box['y'] + pagination_box['height'] > 1000:
            raise AssertionError('Task pagination must stay inside the viewport')

        table_viewport = page.locator('.real-task-table-wrap')
        dimensions = table_viewport.evaluate(
            '(element) => ({ clientHeight: element.clientHeight, '
            'scrollHeight: element.scrollHeight })'
        )
        if expected_default_count >= 20:
            if dimensions['scrollHeight'] <= dimensions['clientHeight']:
                raise AssertionError('Task list must have an independent vertical scrollbar')
            table_viewport.evaluate('(element) => { element.scrollTop = element.scrollHeight; }')
            if table_viewport.evaluate('(element) => element.scrollTop') <= 0:
                raise AssertionError('Task list did not scroll vertically')
            expect(
                page.get_by_role('columnheader', name='任务名称', exact=True)
            ).to_be_visible()

        page.get_by_role('button', name='真实任务每页数量').click()
        page.get_by_role('button', name='50 条 / 页', exact=True).click()
        expected_fifty_count = min(task_page['total'], 50)
        expect(task_rows).to_have_count(expected_fifty_count)
        expect(pagination).to_contain_text(
            f'当前显示 {expected_fifty_count} 条 · 每页 50 条'
        )
        if table_viewport.evaluate('(element) => element.scrollTop') != 0:
            raise AssertionError('Changing page size must reset the list to the top')
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
        finish_status = completed_call['finishStatus']
        if finish_status is not None:
            expected_result = FINISH_STATUS_LABELS.get(
                finish_status, f'未知结果 {finish_status}'
            )
            expect(dialog.get_by_text(expected_result, exact=True)).to_be_visible()
            expect(
                dialog.get_by_text(f'finishStatus: {finish_status}', exact=True)
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
        page.close()
        verify_scroll_and_page_size(browser, task_page['tasks'][0], page_errors)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Stage 6A UI verification passed')
    print(f'List screenshot: {LIST_SCREENSHOT}')
    print(f'Scroll screenshot: {SCROLL_SCREENSHOT}')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
