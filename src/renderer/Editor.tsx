import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { usePreferences } from './preferences';
import type { UserPreferences } from '../shared/preferences';
import { mixColor } from '../shared/style';
function editorTheme(monaco: typeof Monaco, p: UserPreferences): string {
  const name = `lattice-${p.theme}`,
    c = p.colors[p.theme];
  monaco.editor.defineTheme(name, {
    base: p.theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': c.background,
      'editor.foreground': c.font,
      'editorGutter.background': c.background,
      'editorCursor.foreground': c.font,
      'editor.selectionBackground': mixColor(c.background, c.accent, 0.25),
      'editorWidget.background': c.background,
      'editorWidget.border': c.border,
    },
  });
  return name;
}
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'json'
      ? new JsonWorker()
      : ['javascript', 'typescript'].includes(label)
        ? new TsWorker()
        : ['css', 'scss', 'less'].includes(label)
          ? new CssWorker()
          : ['html', 'handlebars', 'razor'].includes(label)
            ? new HtmlWorker()
            : new EditorWorker(),
};
const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 20,
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  padding: { top: 12 },
  accessibilitySupport: 'on',
  fixedOverflowWidgets: true,
};
export function TextEditor({
  value,
  onChange,
  onSave,
  language = 'markdown',
  readOnly = false,
  label = 'Text editor',
}: {
  value: string;
  onChange?: (v: string) => void;
  onSave?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    preferences = usePreferences((s) => s.preferences),
    appearance = useRef(preferences),
    editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null),
    latest = useRef(value),
    callback = useRef(onChange),
    saveCallback = useRef(onSave);
  latest.current = value;
  appearance.current = preferences;
  callback.current = onChange;
  saveCallback.current = onSave;
  useEffect(() => {
    let disposed = false;
    let subscription: Monaco.IDisposable | undefined;
    void import('monaco-editor').then((monaco) => {
      if (disposed || !container.current) return;
      editor.current = monaco.editor.create(container.current, {
        ...options,
        fontFamily: appearance.current.editorFont,
        fontSize: appearance.current.editorFontSize,
        value: latest.current,
        language,
        readOnly,
        ariaLabel: label,
        theme: editorTheme(monaco, appearance.current),
      });
      editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        saveCallback.current?.(editor.current!.getModel()!.getValue(undefined, true)),
      );
      subscription = editor.current.onDidChangeModelContent(() =>
        callback.current?.(editor.current!.getModel()!.getValue(undefined, true)),
      );
    });
    return () => {
      disposed = true;
      subscription?.dispose();
      const model = editor.current?.getModel();
      editor.current?.dispose();
      model?.dispose();
      editor.current = null;
    };
  }, [language, readOnly, label]);
  useEffect(() => {
    void import('monaco-editor').then((monaco) => {
      monaco.editor.setTheme(editorTheme(monaco, preferences));
      editor.current?.updateOptions({
        fontFamily: preferences.editorFont,
        fontSize: preferences.editorFontSize,
      });
    });
  }, [preferences.theme, preferences.colors, preferences.editorFont, preferences.editorFontSize]);
  useEffect(() => {
    if (
      editor.current &&
      !editor.current.hasTextFocus() &&
      editor.current.getModel()!.getValue(undefined, true) !== value
    )
      editor.current.setValue(value);
  }, [value]);
  return <div ref={container} className="code-editor nokey" data-testid="monaco-editor" />;
}
export function DiffEditor({
  before,
  after,
  language = 'markdown',
}: {
  before: string;
  after: string;
  language?: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    preferences = usePreferences((s) => s.preferences),
    appearance = useRef(preferences),
    instance = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  appearance.current = preferences;
  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneDiffEditor | undefined,
      original: Monaco.editor.ITextModel | undefined,
      modified: Monaco.editor.ITextModel | undefined;
    void import('monaco-editor').then((monaco) => {
      if (disposed || !container.current) return;
      original = monaco.editor.createModel(before, language);
      modified = monaco.editor.createModel(after, language);
      editor = monaco.editor.createDiffEditor(container.current, {
        ...options,
        fontFamily: appearance.current.editorFont,
        fontSize: appearance.current.editorFontSize,
        theme: editorTheme(monaco, appearance.current),
        readOnly: true,
        renderSideBySide: true,
        ariaLabel: 'Before and after comparison',
      });
      instance.current = editor;
      editor.setModel({ original, modified });
    });
    return () => {
      disposed = true;
      editor?.dispose();
      instance.current = null;
      original?.dispose();
      modified?.dispose();
    };
  }, [before, after, language]);
  useEffect(() => {
    void import('monaco-editor').then((monaco) => {
      monaco.editor.setTheme(editorTheme(monaco, preferences));
      instance.current?.updateOptions({
        fontFamily: preferences.editorFont,
        fontSize: preferences.editorFontSize,
      });
    });
  }, [preferences.theme, preferences.colors, preferences.editorFont, preferences.editorFontSize]);
  return <div className="diff-editor nokey" ref={container} />;
}
