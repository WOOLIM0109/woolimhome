"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Heading2, Heading3, List, ListOrdered, Pilcrow } from "lucide-react";

/**
 * 본문 편집기.
 *
 * 기존 칼럼 수정 화면 안에만 있었습니다. 새 칼럼을 손으로 쓰는 화면이 생기면서
 * 두 곳이 같은 편집기를 써야 해서 밖으로 뺐습니다. 한쪽에만 두면 나중에
 * 편집기를 고칠 때 다른 쪽이 조용히 뒤처집니다.
 */
export default function VisualHtmlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value && document.activeElement !== editor) {
      editor.innerHTML = value;
    }
  }, [mode, value]);

  const sync = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const command = (name: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    sync();
  };

  return (
    <div className="overflow-hidden rounded-sm border border-[var(--line)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fffaf7] px-3 py-2">
        <div className="flex flex-wrap gap-1" aria-label="본문 서식 도구">
          {mode === "visual" && (
            <>
              <EditorButton label="본문" onClick={() => command("formatBlock", "p")}><Pilcrow size={17} /></EditorButton>
              <EditorButton label="큰 제목" onClick={() => command("formatBlock", "h2")}><Heading2 size={17} /></EditorButton>
              <EditorButton label="작은 제목" onClick={() => command("formatBlock", "h3")}><Heading3 size={17} /></EditorButton>
              <EditorButton label="굵게" onClick={() => command("bold")}><Bold size={17} /></EditorButton>
              <EditorButton label="글머리표" onClick={() => command("insertUnorderedList")}><List size={17} /></EditorButton>
              <EditorButton label="번호 목록" onClick={() => command("insertOrderedList")}><ListOrdered size={17} /></EditorButton>
            </>
          )}
        </div>
        <div className="flex rounded-sm border border-[var(--line)] bg-white p-1 text-sm">
          <button type="button" onClick={() => setMode("visual")} className={`rounded-sm px-3 py-1.5 ${mode === "visual" ? "bg-[#14100c] text-white" : "text-[var(--muted)]"}`}>
            일반 편집
          </button>
          <button type="button" onClick={() => setMode("html")} className={`rounded-sm px-3 py-1.5 ${mode === "html" ? "bg-[#14100c] text-white" : "text-[var(--muted)]"}`}>
            HTML 원문
          </button>
        </div>
      </div>

      {mode === "visual" ? (
        <>
          <p className="border-b border-[var(--line)] bg-[#fffdfb] px-5 py-3 text-sm text-[var(--muted)]">
            실제 게시 화면과 비슷하게 보면서 글자를 직접 고칠 수 있습니다. 문장을 선택한 뒤 위 버튼으로 제목·굵기·목록을 바꿔보세요.
          </p>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={sync}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            }}
            className="column-body min-h-[36rem] px-6 py-7 outline-none lg:px-10"
            dangerouslySetInnerHTML={{ __html: value }}
          />
        </>
      ) : (
        <textarea
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={28}
          className="w-full resize-y p-5 font-mono text-sm leading-6 outline-none"
        />
      )}
    </div>
  );
}

function EditorButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-sm px-2 text-sm text-[#302b27] hover:bg-white"
    >
      {children}<span className="sr-only">{label}</span>
    </button>
  );
}
