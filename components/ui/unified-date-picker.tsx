'use client';

import { useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { zhCN } from 'date-fns/locale';

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

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
