import {
  useState, useRef, useEffect, useCallback,
} from 'react';
import { Mic, Paperclip, Send, Square } from 'lucide-react';
import { useVoice } from '../hooks/useVoice.js';

interface Props {
  onSend:       (text: string) => void;
  onFileUpload?: (content: string, filename: string) => void;
  disabled?:    boolean;
  placeholder?: string;
}

const ACCEPTED = '.md,.txt,.py,.ts,.js,.jsx,.tsx,.html,.css,.json,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.webp';

export function Composer({
  onSend,
  onFileUpload,
  disabled,
  placeholder = 'Type a message…',
}: Props) {
  const [text, setText]       = useState('');
  const textareaRef           = useRef<HTMLTextAreaElement>(null);
  const fileInputRef          = useRef<HTMLInputElement>(null);

  const appendText = useCallback((t: string) => {
    setText((prev) => prev ? `${prev} ${t}` : t);
  }, []);

  const { state: voiceState, interim, start: startVoice, stop: stopVoice } =
    useVoice(appendText);

  const submit = useCallback(() => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    });
  }, [text, disabled, onSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) {
      // Image: base64 encode
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        onFileUpload?.(
          `[Image: ${file.name}]\n${base64}`,
          file.name,
        );
      };
      reader.readAsDataURL(file);

    } else if (ext === 'pdf') {
      // PDF: extract text client-side using PDF.js
      // Load PDF.js from CDN
      const text = await extractPdfText(file);
      onFileUpload?.(text, file.name);
      appendText(`[File: ${file.name}]\n${text.slice(0, 2000)}`);

    } else {
      // Text files: read directly
      const text = await file.text();
      appendText(`[File: ${file.name}]\n${text}`);
    }

    // Reset file input
    e.target.value = '';
  }

  async function extractPdfText(file: File): Promise<string> {
    try {
      // Dynamically load PDF.js only when needed
      // Runtime-only CDN module — non-literal specifier so tsc skips
      // resolution; @vite-ignore so Vite leaves it as a runtime import.
      const cdnUrl =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
      const pdfjsLib = await import(/* @vite-ignore */ cdnUrl) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';

      const arrayBuffer = await file.arrayBuffer();
      const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages       = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, i) => {
          const page    = await pdf.getPage(i + 1);
          const content = await page.getTextContent();
          return content.items.map((item: any) => item.str).join(' ');
        }),
      );
      return pages.join('\n\n');
    } catch {
      return `[Could not extract text from ${file.name}]`;
    }
  }

  const isListening = voiceState === 'listening';

  return (
    <div className="border-t border-white/8 px-3 py-2 pb-safe flex items-end gap-2 flex-shrink-0 bg-surface">
      {/* File upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleFile}
        className="hidden"
        aria-label="Upload file"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
        aria-label="Attach file"
        title="Attach file"
      >
        <Paperclip size={18} />
      </button>

      {/* Voice input */}
      {voiceState !== 'unsupported' && (
        <button
          onClick={isListening ? stopVoice : startVoice}
          disabled={disabled}
          className={`flex-shrink-0 w-8 h-8 flex items-center justify-center transition-colors disabled:opacity-30 ${
            isListening
              ? 'text-red-400 animate-pulse'
              : 'text-white/30 hover:text-white/60'
          }`}
          aria-label={isListening ? 'Stop recording' : 'Start voice input'}
          title={isListening ? 'Stop' : 'Voice input'}
        >
          {isListening ? <Square size={16} /> : <Mic size={18} />}
        </button>
      )}

      {/* Text input */}
      <div className="flex-1 relative">
        {isListening && interim && (
          <div className="absolute -top-8 left-0 right-0 text-xs text-white/40 bg-surface-raised rounded-lg px-2 py-1 truncate">
            {interim}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={isListening ? 'Listening…' : placeholder}
          rows={1}
          aria-label="Message input"
          className="
            w-full placeholder:text-white/30 text-sm
            rounded-2xl px-3.5 py-2.5 resize-none
            focus:outline-none focus:ring-1 focus:ring-white/15
            disabled:opacity-40 disabled:cursor-not-allowed
            selectable
          "
          style={{
            maxHeight: 140,
            // iOS Safari forces a white textarea bg + uses
            // -webkit-text-fill-color, which made the text invisible.
            // Pin an explicit dark field + light text + caret.
            background: '#23232b',
            color: '#f4f4f5',
            WebkitTextFillColor: '#f4f4f5',
            caretColor: '#f4f4f5',
          }}
        />
      </div>

      {/* Send */}
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Send"
        className="
          flex-shrink-0 w-9 h-9 flex items-center justify-center
          bg-indigo-600 hover:bg-indigo-500 text-white rounded-full
          transition-colors active:scale-95
          disabled:opacity-30 disabled:cursor-not-allowed
        "
      >
        <Send size={15} />
      </button>
    </div>
  );
}
