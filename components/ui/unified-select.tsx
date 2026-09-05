'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type UnifiedSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type UnifiedSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: UnifiedSelectOption[];
  ariaLabel: string;
  placeholder?: string;
  triggerLabel?: string;
  popupLabel?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
};

export function UnifiedSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = '请选择',
  triggerLabel,
  popupLabel,
  className,
  contentClassName,
  disabled = false,
}: UnifiedSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'unified-select-trigger',
          !selectedOption && 'is-placeholder',
          className,
        )}
      >
        <span
          className={cn(triggerLabel && 'unified-select-trigger-copy')}
          title={selectedOption?.label}
        >
          {triggerLabel ? <small>{triggerLabel}</small> : null}
          {triggerLabel ? (
            <strong>{selectedOption?.label ?? placeholder}</strong>
          ) : (
            (selectedOption?.label ?? placeholder)
          )}
        </span>
        <ChevronDown aria-hidden="true" size={14} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn('unified-select-content', contentClassName)}
      >
        {popupLabel ? (
          <span className="unified-select-label">{popupLabel}</span>
        ) : null}
        <menu
          className="unified-select-options"
          style={{ margin: 0, padding: 0 }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                aria-pressed={selected}
                disabled={option.disabled}
                className={cn(
                  'unified-select-option',
                  selected && 'is-selected',
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? (
                    <small>{option.description}</small>
                  ) : null}
                </span>
                {selected ? <Check aria-hidden="true" size={14} /> : null}
              </button>
            );
          })}
        </menu>
      </PopoverContent>
    </Popover>
  );
}
