def assert_dialog_has_no_outer_overflow(page, dialog, label: str) -> None:
    page.wait_for_timeout(180)
    metrics = dialog.evaluate(
        '''element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            };
        }'''
    )
    viewport = page.viewport_size
    if not viewport:
        raise AssertionError(f'{label} viewport is unavailable')
    if metrics['overflowX'] in ('auto', 'scroll') or metrics['overflowY'] in (
        'auto',
        'scroll',
    ):
        raise AssertionError(f'{label} allows outer scrolling: {metrics}')
    if metrics['scrollWidth'] > metrics['clientWidth'] + 1:
        raise AssertionError(f'{label} clips horizontally: {metrics}')
    if metrics['scrollHeight'] > metrics['clientHeight'] + 1:
        raise AssertionError(f'{label} clips vertically: {metrics}')
    if (
        metrics['left'] < -1
        or metrics['top'] < -1
        or metrics['right'] > viewport['width'] + 1
        or metrics['bottom'] > viewport['height'] + 1
    ):
        raise AssertionError(f'{label} escapes the viewport: {metrics}')
