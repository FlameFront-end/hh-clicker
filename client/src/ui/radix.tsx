import { Children, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { DropdownMenu, Select as RSelect, Slider as RSlider, Switch, Tooltip } from 'radix-ui';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import r from './Radix.module.css';

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <Switch.Root className={r.switch} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}>
      <Switch.Thumb className={r.thumb} />
    </Switch.Root>
  );
}

export const TipProvider = Tooltip.Provider;
export function Tip({ text, children }: { text?: ReactNode; children: ReactNode }) {
  if (!text) return <>{children}</>;
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className={r.tip} sideOffset={6}>{text}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export function MenuContent({ children }: { children: ReactNode }) {
  return <DropdownMenu.Portal><DropdownMenu.Content className={r.menu} align="end" sideOffset={6}>{children}</DropdownMenu.Content></DropdownMenu.Portal>;
}
export function MenuItem({ icon, children, onSelect, danger, disabled, right }: { icon?: IconName; children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; right?: ReactNode }) {
  return (
    <DropdownMenu.Item className={`${r.item} ${danger ? r.danger : ''}`} disabled={disabled} onSelect={onSelect}>
      {icon && <Icon name={icon} size={14} />}{children}{right && <span className={r.right}>{right}</span>}
    </DropdownMenu.Item>
  );
}
export function MenuCheck({ icon, children, checked, onChange, disabled }: { icon?: IconName; children: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <DropdownMenu.CheckboxItem className={r.item} checked={checked} disabled={disabled} onCheckedChange={onChange} onSelect={(e) => e.preventDefault()}>
      {icon && <Icon name={icon} size={14} />}{children}
      <span className={r.check}><DropdownMenu.ItemIndicator><Icon name="check" size={13} tone="ok" /></DropdownMenu.ItemIndicator></span>
    </DropdownMenu.CheckboxItem>
  );
}
export const MenuSep = () => <DropdownMenu.Separator className={r.sep} />;

/* Select: замена нативному <select>. Принимает <option> как дети и onChange с e.target.value. */
const EMPTY = '__empty__';
const textOf = (n: ReactNode): string => (Array.isArray(n) ? n.map(textOf).join('') : n == null || typeof n === 'boolean' ? '' : String(n));
type Opt = { value: string; label: string; disabled?: boolean };

export function Select({ value, onChange, children, style, disabled, placeholder, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, id }: {
  value?: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
}) {
  const opts: Opt[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
    const label = textOf(el.props.children);
    opts.push({ value: el.props.value != null ? String(el.props.value) : label, label, disabled: el.props.disabled });
  });
  const cur = String(value ?? '');
  const hit = opts.find((o) => o.value === cur) ?? opts.find((o) => o.value === '');
  return (
    <RSelect.Root value={cur === '' ? EMPTY : cur} onValueChange={(v) => onChange({ target: { value: v === EMPTY ? '' : v } })} disabled={disabled}>
      <RSelect.Trigger id={id} className={r.select} style={style} aria-label={ariaLabel ?? placeholder} aria-labelledby={ariaLabelledBy}>
        <span className={r.selectVal}>{hit?.label || placeholder || '—'}</span>
        <RSelect.Icon><Icon name="chevron-down" size={14} /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className={r.selectMenu} position="popper" sideOffset={6} align="start">
          <RSelect.Viewport className={r.selectVp}>
            {opts.map((o) => (
              <RSelect.Item key={o.value} value={o.value === '' ? EMPTY : o.value} disabled={o.disabled} className={r.item}>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <span className={r.check}><RSelect.ItemIndicator><Icon name="check" size={13} tone="ok" /></RSelect.ItemIndicator></span>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Slider({ value, onChange, onCommit, min, max, step, label }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; min: number; max: number; step: number; label: string }) {
  return (
    <RSlider.Root className={r.slider} value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0] ?? min)} onValueCommit={(v) => onCommit?.(v[0] ?? min)}>
      <RSlider.Track className={r.sliderTrack}><RSlider.Range className={r.sliderRange} /></RSlider.Track>
      <RSlider.Thumb className={r.sliderThumb} aria-label={label} />
    </RSlider.Root>
  );
}
