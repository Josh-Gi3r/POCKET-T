import { useState, useRef, useCallback } from 'react';

type VoiceState = 'unsupported' | 'idle' | 'listening' | 'error';

export function useVoice(onResult: (text: string) => void) {
  const [state, setState]       = useState<VoiceState>(
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
      ? 'idle'
      : 'unsupported',
  );
  const [interim, setInterim]   = useState('');
  const recognitionRef          = useRef<any>(null);

  const start = useCallback(() => {
    if (state === 'unsupported') return;

    const SR = (window as any).SpeechRecognition ||
               (window as any).webkitSpeechRecognition;
    const recognition = new SR();

    recognition.continuous      = false;
    recognition.interimResults  = true;
    recognition.lang            = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState('listening');

    recognition.onresult = (e: any) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final   += e.results[i][0].transcript;
        else                      interim += e.results[i][0].transcript;
      }
      setInterim(interim);
      if (final) {
        onResult(final.trim());
        setInterim('');
      }
    };

    recognition.onerror = () => {
      setState('idle');
      setInterim('');
    };

    recognition.onend = () => {
      setState('idle');
      setInterim('');
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [state, onResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { state, interim, start, stop };
}
