'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { zhCN } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

type UnifiedDatePickerProps = {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  mode?: 'date' | 'month';
  min?: string;
  max?: string;
  placeholder?: string;
  popupLabel?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
};

export type UnifiedDateRangeValue = {
  start: string;
  end: string;
};

type UnifiedDateRangePickerProps = {
  value: UnifiedDateRangeValue;
  onValueChange: (value: UnifiedDateRangeValue) => void;
  ariaLabel: string;
  min?: string;
  max?: string;
  placeholder?: string;
  popupLabel?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
};

export function UnifiedDatePicker({
  value,
  onValueChange,
  ariaLabel,
  mode = 'date',
  min,
  max,
  placeholder = mode === 'month' ? '选择月份' : '选择日期',
  popupLabel = mode === 'month' ? '选择月份' : '选择日期',
  className,
  clearable = false,
  disabled = false,
  ariaInvalid,
  ariaDescribedBy,
}: UnifiedDatePickerProps) {
  const [open, setOpen] = useState(false);
  const initialDate = parseDateKey(value, mode) ?? new Date();
  const [visibleDate, setVisibleDate] = useState(initialDate);
  const selectedDate = parseDateKey(value, mode);
  const minDate = parseDateKey(min ?? '', mode);
  const maxDate = parseDateKey(max ?? '', mode);

  const label = value ? formatDateKey(value, mode) : placeholder;
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  const chooseValue = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setVisibleDate(selectedDate ?? new Date());
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={cn(
          'unified-date-trigger',
          !value && 'is-placeholder',
          className,
        )}
      >
        <span>{label}</span>
        <CalendarDays aria-hidden="true" size={14} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="unified-date-content"
      >
        <span className="unified-date-popup-label">{popupLabel}</span>
        {mode === 'month' ? (
          <MonthGrid
            value={value}
            visibleDate={visibleDate}
            min={min}
            max={max}
            onVisibleDateChange={setVisibleDate}
            onSelect={chooseValue}
          />
        ) : (
          <Calendar
            mode="single"
            locale={zhCN}
            month={visibleDate}
            selected={selectedDate}
            onMonthChange={setVisibleDate}
            onSelect={(date) => {
              if (date) chooseValue(toDateKey(date));
            }}
            disabled={disabledMatchers}
          />
        )}
        {clearable && value ? (
          <button
            type="button"
            className="unified-date-clear"
            onClick={() => chooseValue('')}
          >
            清除已选{mode === 'month' ? '月份' : '日期'}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function UnifiedDateRangePicker({
  value,
  onValueChange,
  ariaLabel,
  min,
  max,
  placeholder = '选择日期范围',
  popupLabel = '选择日期范围',
  className,
  clearable = false,
  disabled = false,
}: UnifiedDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedRange = dateRangeFromValue(value);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(
    selectedRange,
  );
  const [visibleDate, setVisibleDate] = useState(
    selectedRange?.from ?? new Date(),
  );
  const [numberOfMonths, setNumberOfMonths] = useState(2);
  const minDate = parseDateKey(min ?? '', 'date');
  const maxDate = parseDateKey(max ?? '', 'date');
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];
  const hasValue = Boolean(value.start || value.end);
  const label = hasValue ? formatDateRangeValue(value) : placeholder;
  const draftStart = draftRange?.from
    ? formatDateKey(toDateKey(draftRange.from), 'date')
    : '请选择';
  const draftEnd = draftRange?.to
    ? formatDateKey(toDateKey(draftRange.to), 'date')
    : draftRange?.from
      ? '继续选择'
      : '请选择';

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 680px)');
    const updateMonthCount = () => setNumberOfMonths(mediaQuery.matches ? 1 : 2);
    updateMonthCount();
    mediaQuery.addEventListener('change', updateMonthCount);
    return () => mediaQuery.removeEventListener('change', updateMonthCount);
  }, []);

  const applyRange = () => {
    if (!draftRange?.from) return;
    const end = draftRange.to ?? draftRange.from;
    onValueChange({
      start: toDateKey(draftRange.from),
      end: toDateKey(end),
    });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const currentRange = dateRangeFromValue(value);
          setDraftRange(currentRange);
          setVisibleDate(currentRange?.from ?? new Date());
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'unified-date-trigger unified-date-range-trigger',
          !hasValue && 'is-placeholder',
          className,
        )}
      >
        <span>{label}</span>
        <CalendarDays aria-hidden="true" size={14} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="unified-date-content unified-date-range-content"
      >
        <span className="unified-date-popup-label">
          {popupLabel}
          <small>支持跨月选择</small>
        </span>
        <div className="unified-date-range-selection" aria-live="polite">
          <span>
            <small>开始</small>
            <b>{draftStart}</b>
          </span>
          <ArrowRight aria-hidden="true" size={13} />
          <span>
            <small>结束</small>
            <b>{draftEnd}</b>
          </span>
        </div>
        <Calendar
          mode="range"
          locale={zhCN}
          month={visibleDate}
          selected={draftRange}
          onMonthChange={setVisibleDate}
          onSelect={setDraftRange}
          disabled={disabledMatchers}
          numberOfMonths={numberOfMonths}
        />
        <div className="unified-date-range-actions">
          {clearable ? (
            <button
              type="button"
              className="is-clear"
              disabled={!hasValue && !draftRange?.from}
              onClick={() => {
                setDraftRange(undefined);
                onValueChange({ start: '', end: '' });
                setOpen(false);
              }}
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            className="is-cancel"
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={!draftRange?.from}
            onClick={applyRange}
          >
            确认范围
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({
  value,
  visibleDate,
  min,
  max,
  onVisibleDateChange,
  onSelect,
}: {
  value: string;
  visibleDate: Date;
  min?: string;
  max?: string;
  onVisibleDateChange: (date: Date) => void;
  onSelect: (value: string) => void;
}) {
  const year = visibleDate.getFullYear();
  const minYear = min ? Number(min.slice(0, 4)) : null;
  const maxYear = max ? Number(max.slice(0, 4)) : null;
  const canGoPrevious = minYear === null || year > minYear;
  const canGoNext = maxYear === null || year < maxYear;

  return (
    <div className="unified-month-picker">
      <div className="unified-month-nav">
        <button
          type="button"
          aria-label="上一年"
          disabled={!canGoPrevious}
          onClick={() => onVisibleDateChange(new Date(year - 1, 0, 1, 12))}
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
        <b>{year} 年</b>
        <button
          type="button"
          aria-label="下一年"
          disabled={!canGoNext}
          onClick={() => onVisibleDateChange(new Date(year + 1, 0, 1, 12))}
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      </div>
      <fieldset className="unified-month-grid" aria-label={`${year} 年月份`}>
        {Array.from({ length: 12 }, (_, index) => {
          const monthValue = `${year}-${String(index + 1).padStart(2, '0')}`;
          const selected = monthValue === value;
          const unavailable = Boolean(
            (min && monthValue < min) || (max && monthValue > max),
          );
          return (
            <button
              type="button"
              key={monthValue}
              aria-pressed={selected}
              disabled={unavailable}
              className={selected ? 'is-selected' : ''}
              onClick={() => onSelect(monthValue)}
            >
              <span>{index + 1} 月</span>
              {selected ? <Check aria-hidden="true" size={12} /> : null}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

function parseDateKey(value: string, mode: 'date' | 'month') {
  const match =
    mode === 'month'
      ? /^(\d{4})-(\d{2})$/.exec(value)
      : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    mode === 'month' ? 1 : Number(match[3]),
    12,
  );
}

function formatDateKey(value: string, mode: 'date' | 'month') {
  const date = parseDateKey(value, mode);
  if (!date) return value;
  return mode === 'month'
    ? `${date.getFullYear()} 年 ${String(date.getMonth() + 1).padStart(2, '0')} 月`
    : `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function dateRangeFromValue(value: UnifiedDateRangeValue) {
  const from = parseDateKey(value.start, 'date');
  const to = parseDateKey(value.end, 'date');
  if (!from && !to) return undefined;
  return {
    from: from ?? to,
    to: to ?? from,
  } satisfies DateRange;
}

function formatDateRangeValue(value: UnifiedDateRangeValue) {
  const start = value.start
    ? formatDateKey(value.start, 'date')
    : '开始日期';
  const end = value.end ? formatDateKey(value.end, 'date') : '结束日期';
  return `${start} — ${end}`;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
