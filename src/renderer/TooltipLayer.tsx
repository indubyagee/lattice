import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { CONTROL_HELP, INSPECTOR_HELP } from './help-content';
import { usePreferences } from './preferences';
const id = 'lattice-context-tooltip';
export function TooltipLayer() {
  const delay = usePreferences((s) => s.preferences.tooltipDelay),
    fontSize = usePreferences((s) => s.preferences.tooltipFontSize),
    graphTooltips = usePreferences((s) => s.preferences.graphTooltips),
    delayRef = useRef(delay),
    element = useRef<HTMLDivElement>(null);
  delayRef.current = delay;
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(
    null,
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      hideTimer: ReturnType<typeof setTimeout> | undefined,
      anchor: HTMLElement | null = null,
      described: HTMLElement | null = null,
      dismissed: HTMLElement | null = null;
    const clear = () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      if (described) {
        const refs = (described.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .filter((v) => v && v !== id);
        if (refs.length) described.setAttribute('aria-describedby', refs.join(' '));
        else described.removeAttribute('aria-describedby');
      }
      described = null;
      anchor = null;
      setTip(null);
    };
    const find = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement || target instanceof SVGElement)) return null;
      if (!graphTooltips && target.closest('.flow-surface')) return null;
      let a = target.closest<HTMLElement>('[data-help]');
      let text = a?.dataset.help ?? '';
      if (!a) {
        const node = target.closest<HTMLElement>('.react-flow__node');
        a = node?.querySelector<HTMLElement>('[data-help]') ?? null;
        text = a?.dataset.help ?? '';
      }
      if (!a) {
        const label = target.closest<HTMLElement>('.inspector label');
        if (label) {
          a = label;
          const field = label.querySelector<HTMLElement>('input,select,textarea');
          const name =
            field?.getAttribute('aria-label') ??
            [...label.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent?.trim())
              .filter(Boolean)
              .join(' ');
          text =
            INSPECTOR_HELP[name] ??
            `${name || 'Property'}: Edit the selected record’s shared design value. Invalid or incomplete values remain editable and produce Findings.`;
        }
      }
      if (!a) {
        const button = target.closest<HTMLElement>('button');
        if (button) {
          const label = (button.getAttribute('aria-label') ?? button.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          const key = Object.keys(CONTROL_HELP)
            .sort((a, b) => b.length - a.length)
            .find((key) => label.startsWith(key));
          if (key) {
            a = button;
            text = CONTROL_HELP[key]!;
          }
        }
      }
      return a && text ? { anchor: a, text } : null;
    };
    const show = (target: EventTarget | null, keyboard = false) => {
      const found = find(target);
      if (!found) {
        clear();
        return;
      }
      clearTimeout(hideTimer);
      if (found.anchor === dismissed) return;
      if (found.anchor === anchor && !keyboard) return;
      clear();
      anchor = found.anchor;
      const current = anchor;
      timer = setTimeout(() => {
        if (anchor !== current || !current.isConnected) return;
        const r = current.getBoundingClientRect(),
          width = Math.min(340, innerWidth - 24);
        const above = r.bottom > innerHeight - 190;
        described = keyboard && target instanceof HTMLElement ? target : current;
        described.setAttribute(
          'aria-describedby',
          `${described.getAttribute('aria-describedby') ?? ''} ${id}`.trim(),
        );
        setTip({
          text: found.text,
          x: Math.max(12, Math.min(innerWidth - width - 12, r.left)),
          y: above ? r.top - 9 : r.bottom + 9,
          above,
        });
      }, delayRef.current);
    };
    const over = (e: PointerEvent) => {
      if ((e.target as Element)?.closest?.(`#${id}`)) {
        clearTimeout(hideTimer);
        return;
      }
      show(e.target);
    };
    const out = (e: PointerEvent) => {
      const related = e.relatedTarget;
      if (related instanceof Element && (anchor?.contains(related) || related.closest(`#${id}`)))
        return;
      dismissed = null;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(clear, 120);
    };
    const focus = (e: FocusEvent) => {
      dismissed = null;
      show(e.target, true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (described) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        dismissed = anchor;
        clear();
      }
    };
    const scroll = () => clear();
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', clear);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', clear);
    return () => {
      clear();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', clear);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', clear);
    };
  }, [graphTooltips]);
  useLayoutEffect(() => {
    const r = element.current?.getBoundingClientRect();
    if (!r || !tip) return;
    const x = Math.max(12, Math.min(innerWidth - r.width - 12, r.left)),
      y = Math.max(12, Math.min(innerHeight - r.height - 12, r.top));
    if (Math.abs(x - r.left) > 1 || Math.abs(y - r.top) > 1) setTip({ ...tip, x, y, above: false });
  }, [tip, fontSize]);
  return tip ? (
    <div
      id={id}
      role="tooltip"
      className="context-tooltip"
      ref={element}
      style={{ left: tip.x, top: tip.y, transform: tip.above ? 'translateY(-100%)' : undefined }}
    >
      {tip.text}
    </div>
  ) : null;
}
