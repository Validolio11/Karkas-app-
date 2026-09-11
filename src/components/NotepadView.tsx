import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NotepadNote, NoteSortOption } from '../types';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import { karkasApiFetch } from '../utils/desktopApi';
import {
  NotebookPen,
  Search,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Pin,
  PinOff,
  Mic,
  Square,
  Loader2,
  Calendar,
  Clock,
  ArrowUpDown,
  X,
  Palette,
  LayoutGrid,
  List,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NotepadViewProps {
  lang: Language;
  notes: NotepadNote[];
  onAddNote: (note: Omit<NotepadNote, 'id' | 'createdAt'>) => void;
  onUpdateNote: (id: string, updates: Partial<NotepadNote>) => void;
  onDeleteNote: (id: string) => void;
}

export const NOTE_COLOR_PRESETS = [
  { label: 'Sky', hex: '#38bdf8' },
  { label: 'Emerald', hex: '#34d399' },
  { label: 'Amber', hex: '#fbbf24' },
  { label: 'Rose', hex: '#f43f5e' },
  { label: 'Purple', hex: '#c084fc' },
  { label: 'Cyan', hex: '#22d3ee' },
  { label: 'Orange', hex: '#fb923c' },
  { label: 'White', hex: '#e2e8f0' },
];

export const NotepadView: React.FC<NotepadViewProps> = ({
  lang,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}) => {
  const t = TRANSLATIONS[lang];
  const nv = t.notepadView;

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<NoteSortOption>('NEWEST');
  const [selectedColorFilter, setSelectedColorFilter] = useState<string | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // New Note Composer state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(NOTE_COLOR_PRESETS[0].hex);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<'content' | 'title'>('content');

  // Inline edit state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editColor, setEditColor] = useState<string>(NOTE_COLOR_PRESETS[0].hex);

  // Copied feedback state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Undo delete safety state
  const [recentlyDeletedNote, setRecentlyDeletedNote] = useState<NotepadNote | null>(null);

  // Voice recording state
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const contentBeforeRecordingRef = useRef<string>('');

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editTitleInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-dismiss undo note toast after 8 seconds
  useEffect(() => {
    if (!recentlyDeletedNote) return;
    const timer = setTimeout(() => {
      setRecentlyDeletedNote(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [recentlyDeletedNote]);

  // Voice recording duration timer
  useEffect(() => {
    if (!isListening) {
      setRecordingDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  // Clean up recording on unmount
  useEffect(() => {
    return () => {
      stopVoiceInput();
    };
  }, []);

  // Keyboard navigation shortcuts within NotepadView
  useEffect(() => {
    const handleLocalKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isListening) {
          stopVoiceInput();
          return;
        }
        if (editingNoteId) {
          handleCancelEdit();
          return;
        }
        if (isComposerOpen) {
          setIsComposerOpen(false);
          return;
        }
        if (searchQuery) {
          setSearchQuery('');
          return;
        }
      }

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        sound.tick(500);
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleLocalKeyDown);
    return () => window.removeEventListener('keydown', handleLocalKeyDown);
  }, [isListening, editingNoteId, isComposerOpen, searchQuery]);

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsListening(false);
  };

  const transcribeRecordedAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      reader.readAsDataURL(blob);
      const audioBase64 = await base64Promise;

      const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      const customApiKey = localStorage.getItem('karkas_custom_api_key') || undefined;
      const customModel = localStorage.getItem('karkas_custom_model') || undefined;
      const res = await karkasApiFetch('/api/ai/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: rawBase64,
          mimeType: blob.type || 'audio/webm',
          lang,
          customApiKey,
          model: customModel,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          applyTranscribedText(data.text.trim());
          sound.tick(800);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Мовлення не виявлено. Спробуйте ще раз.' : 'No speech detected. Please try again.');
          sound.tick(300);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setVoiceNotice(errData.error || (lang === 'uk' ? 'Помилка транскрипції аудіо' : 'Audio transcription error'));
        sound.tick(300);
      }
    } catch (err: any) {
      console.error('Audio transcription error:', err);
      setVoiceNotice(lang === 'uk' ? 'Помилка розпізнавання аудіо' : 'Audio transcription error');
      sound.tick(300);
    } finally {
      setIsTranscribing(false);
    }
  };

  const applyTranscribedText = (spoken: string) => {
    if (editingNoteId) {
      setEditContent((prev) => (prev ? `${prev} ${spoken}` : spoken));
      return;
    }
    if (voiceTarget === 'title') {
      setTitle((prev) => (prev ? `${prev} ${spoken}` : spoken));
    } else {
      setContent((prev) => (prev ? `${prev} ${spoken}` : spoken));
    }
  };

  const startMediaRecorderFallback = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceNotice(lang === 'uk' ? 'Мікрофон не підтримується цим середовищем' : 'Microphone is not supported');
      sound.tick(300);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        if (audioBlob.size > 200) {
          await transcribeRecordedAudio(audioBlob);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Запис занадто короткий' : 'Recording too short');
          sound.tick(300);
        }
      };

      recorder.start(250);
      setIsListening(true);
      sound.tick(750);
    } catch (err) {
      console.error('Microphone access failed:', err);
      setVoiceNotice(lang === 'uk' ? 'Доступ до мікрофона заблоковано' : 'Microphone access blocked');
      sound.tick(300);
      setIsListening(false);
    }
  };

  const handleToggleVoiceInput = (target: 'content' | 'title' = 'content') => {
    setVoiceTarget(target);
    if (isListening) {
      sound.tick(400);
      stopVoiceInput();
      return;
    }

    setVoiceNotice(null);
    contentBeforeRecordingRef.current = editingNoteId
      ? editContent
      : target === 'title'
      ? title
      : content;

    const isDesktop = Boolean((window as any).karkasDesktop);

    // In Electron Desktop, Google Web Speech API is not supported by Chromium.
    // Use MediaRecorder with Gemini transcription directly.
    if (!isDesktop) {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = lang === 'uk' ? 'uk-UA' : 'en-US';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;

          let accumulatedFinal = '';

          recognition.onstart = () => {
            setIsListening(true);
            sound.tick(750);
          };

          recognition.onresult = (event: any) => {
            let currentInterim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                accumulatedFinal += (accumulatedFinal ? ' ' : '') + transcript.trim();
              } else {
                currentInterim += transcript;
              }
            }

            const spoken = (accumulatedFinal + (currentInterim ? ' ' + currentInterim : '')).trim();
            const base = contentBeforeRecordingRef.current.trim();
            const combined = base ? `${base} ${spoken}` : spoken;

            if (editingNoteId) {
              setEditContent(combined);
            } else if (target === 'title') {
              setTitle(combined);
            } else {
              setContent(combined);
            }
          };

          recognition.onerror = (event: any) => {
            console.warn('Speech recognition error, falling back to MediaRecorder:', event.error);
            stopVoiceInput();
            if (event.error !== 'no-speech') {
              startMediaRecorderFallback();
            }
          };

          recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
          };

          recognitionRef.current = recognition;
          recognition.start();
          return;
        } catch (e) {
          console.warn('SpeechRecognition failed, falling back to MediaRecorder', e);
        }
      }
    }

    startMediaRecorderFallback();
  };

  const handleSaveNewNote = () => {
    if (!title.trim() && !content.trim()) return;

    sound.tick(700);
    const finalTitle = title.trim() || (lang === 'uk' ? 'Без назви' : 'Untitled note');

    onAddNote({
      title: finalTitle,
      content: content.trim(),
      color: selectedColor,
      pinned: false,
    });

    setTitle('');
    setContent('');
    setIsComposerOpen(false);
    stopVoiceInput();
  };

  const handleStartEdit = (note: NotepadNote) => {
    sound.tick(500);
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color || NOTE_COLOR_PRESETS[0].hex);
    setTimeout(() => {
      editTitleInputRef.current?.focus();
    }, 100);
  };

  const handleCancelEdit = () => {
    sound.tick(400);
    setEditingNoteId(null);
    setEditTitle('');
    setEditContent('');
    stopVoiceInput();
  };

  const handleSaveEdit = () => {
    if (!editingNoteId) return;
    if (!editTitle.trim() && !editContent.trim()) return;

    sound.tick(700);
    onUpdateNote(editingNoteId, {
      title: editTitle.trim() || (lang === 'uk' ? 'Без назви' : 'Untitled note'),
      content: editContent.trim(),
      color: editColor,
      updatedAt: Date.now(),
    });

    setEditingNoteId(null);
    stopVoiceInput();
  };

  const handleDeleteWithUndo = (note: NotepadNote) => {
    sound.tick(400);
    setRecentlyDeletedNote(note);
    onDeleteNote(note.id);
  };

  const handleRestoreDeletedNote = () => {
    if (!recentlyDeletedNote) return;
    sound.tick(700);
    onAddNote({
      title: recentlyDeletedNote.title,
      content: recentlyDeletedNote.content,
      color: recentlyDeletedNote.color,
      pinned: recentlyDeletedNote.pinned,
    });
    setRecentlyDeletedNote(null);
  };

  const handleCopyNote = (note: NotepadNote) => {
    sound.tick(600);
    const textToCopy = `${note.title}\n\n${note.content}`.trim();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy);
    }
    setCopiedId(note.id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === note.id ? null : curr));
    }, 1800);
  };

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp);
    return d.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filter and Sort notes
  const filteredAndSortedNotes = useMemo(() => {
    let result = [...notes];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      );
    }

    // Color filter
    if (selectedColorFilter !== 'ALL') {
      result = result.filter((n) => (n.color || NOTE_COLOR_PRESETS[0].hex) === selectedColorFilter);
    }

    // Sorting: Pinned notes always stay on top
    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      if (sortOption === 'NEWEST') {
        return b.createdAt - a.createdAt;
      } else if (sortOption === 'OLDEST') {
        return a.createdAt - b.createdAt;
      } else if (sortOption === 'DATE') {
        // Sort by last activity / update timestamp
        const timeA = a.updatedAt || a.createdAt;
        const timeB = b.updatedAt || b.createdAt;
        return timeB - timeA;
      }
      return 0;
    });

    return result;
  }, [notes, searchQuery, selectedColorFilter, sortOption]);

  const pinnedCount = useMemo(() => notes.filter((n) => n.pinned).length, [notes]);

  return (
    <div className="w-full space-y-4">
      {/* 1. Primary Hierarchy: Search Bar & New Note Trigger (Matches KARKAS App-wide Pattern) */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={nv.searchPlaceholder}
            className="w-full pl-9 pr-8 py-2.5 bg-[#09090d] border border-neutral-800 text-neutral-200 placeholder-neutral-500 text-xs font-mono focus:outline-none focus:border-neutral-500 transition-colors shadow-inner"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            sound.tick(600);
            setIsComposerOpen((prev) => !prev);
            setTimeout(() => {
              if (!isComposerOpen) titleInputRef.current?.focus();
            }, 100);
          }}
          className="px-3.5 py-2.5 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs font-mono tracking-wider uppercase transition-all flex items-center gap-1.5 shrink-0 active:scale-95 cursor-pointer shadow-sm"
        >
          {isComposerOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>{isComposerOpen ? nv.cancel : nv.newNote}</span>
        </button>
      </div>

      {/* 2. Secondary Hierarchy: Sleek Meta & Sorting Rail (No bloated wide card wrapper) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pt-0.5">
        {/* Left: Quick Color / Category Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              sound.tick(500);
              setSelectedColorFilter('ALL');
            }}
            className={`px-2 py-1 text-[11px] font-mono tracking-wider uppercase border transition-all cursor-pointer ${
              selectedColorFilter === 'ALL'
                ? 'border-neutral-600 bg-neutral-800 text-white font-bold'
                : 'border-neutral-800 bg-[#0a0a0d] text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
            }`}
          >
            {nv.allColors} ({notes.length})
          </button>

          <div className="flex items-center gap-1 bg-[#0a0a0d] border border-neutral-800 p-1">
            {NOTE_COLOR_PRESETS.map((c) => {
              const isSelected = selectedColorFilter === c.hex;
              return (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => {
                    sound.tick(400);
                    setSelectedColorFilter(isSelected ? 'ALL' : c.hex);
                  }}
                  title={c.label}
                  className={`w-3.5 h-3.5 transition-all cursor-pointer flex items-center justify-center ${
                    isSelected ? 'ring-1.5 ring-white scale-110 shadow-sm' : 'opacity-65 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          </div>

          {pinnedCount > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 bg-neutral-900 border border-neutral-800 text-amber-300 flex items-center gap-1">
              <Pin className="w-2.5 h-2.5" />
              <span>{pinnedCount}</span>
            </span>
          )}
        </div>

        {/* Right: Compact Sorting Controls + Grid/List Toggle */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="flex items-center gap-1 bg-[#0a0a0d] border border-neutral-800 p-0.5">
            <span className="text-[10px] font-mono text-neutral-500 px-1.5 uppercase tracking-wider flex items-center gap-1">
              <ArrowUpDown className="w-2.5 h-2.5" />
              <span className="hidden md:inline">{nv.sortLabel}</span>
            </span>
            {(['NEWEST', 'OLDEST', 'DATE'] as NoteSortOption[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  sound.tick(500);
                  setSortOption(opt);
                }}
                className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer ${
                  sortOption === opt
                    ? 'bg-neutral-200 text-black font-extrabold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {opt === 'NEWEST'
                  ? nv.sortNewest
                  : opt === 'OLDEST'
                  ? nv.sortOldest
                  : nv.sortDate}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center border border-neutral-800 bg-[#0a0a0d] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1 transition-colors cursor-pointer ${
                viewMode === 'grid' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="List view"
              className={`p-1 transition-colors cursor-pointer ${
                viewMode === 'list' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Note Composer (Styled clean and disciplined like QuickAddDrawer) */}
      <AnimatePresence>
        {isComposerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border border-neutral-800 bg-[#0a0a0d] p-4 font-mono space-y-3 shadow-lg">
              {/* Top status of composer */}
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800/80 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedColor }} />
                  <span className="font-bold uppercase tracking-wider text-neutral-300">
                    {nv.newNote}
                  </span>
                </div>
                <div className="text-[10px] text-neutral-500">
                  <span>{lang === 'uk' ? 'Ctrl + Enter для збереження' : 'Ctrl + Enter to save'}</span>
                </div>
              </div>

              {/* Title input with dictation & color dot */}
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                <div className="relative flex-1">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        handleSaveNewNote();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        contentTextareaRef.current?.focus();
                      }
                    }}
                    placeholder={nv.titlePlaceholder}
                    style={{ color: selectedColor }}
                    className="w-full bg-[#060608] border border-neutral-800 text-sm font-mono font-bold pl-3 pr-9 py-2 focus:outline-none focus:border-neutral-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => handleToggleVoiceInput('title')}
                    title={lang === 'uk' ? 'Надиктувати назву' : 'Dictate title'}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 transition-colors cursor-pointer ${
                      isListening && voiceTarget === 'title'
                        ? 'text-red-400 animate-pulse'
                        : 'text-neutral-500 hover:text-white'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Color Palette Selector */}
                <div className="flex items-center gap-1.5 bg-[#060608] border border-neutral-800 px-2.5 py-1.5 shrink-0">
                  <Palette className="w-3 h-3 text-neutral-500 mr-0.5" />
                  {NOTE_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => {
                        sound.tick(400);
                        setSelectedColor(preset.hex);
                      }}
                      title={preset.label}
                      style={{ backgroundColor: preset.hex }}
                      className={`w-3.5 h-3.5 transition-all cursor-pointer ${
                        selectedColor === preset.hex
                          ? 'ring-1.5 ring-white scale-125'
                          : 'opacity-65 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Note Content Textarea */}
              <div className="relative">
                <textarea
                  ref={contentTextareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveNewNote();
                  }}
                  placeholder={nv.contentPlaceholder}
                  rows={3}
                  className="w-full bg-[#060608] border border-neutral-800 text-neutral-200 placeholder:text-neutral-500 text-xs font-mono p-3 focus:outline-none focus:border-neutral-500 transition-colors leading-relaxed"
                />
              </div>

              {/* Voice Recording Live Feedback */}
              {(isListening || isTranscribing || voiceNotice) && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#060608] border border-neutral-800 text-xs font-mono">
                  {voiceNotice ? (
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span className="text-[11px]">{voiceNotice}</span>
                    </div>
                  ) : isTranscribing ? (
                    <div className="flex items-center gap-2 text-neutral-300">
                      <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                      <span className="text-[11px]">{lang === 'uk' ? 'ШІ транскрибує голос...' : 'Transcribing voice...'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[11px] text-red-400 font-bold uppercase tracking-wider">
                          {nv.voiceListening} ({voiceTarget === 'title' ? (lang === 'uk' ? 'в заголовок' : 'to title') : (lang === 'uk' ? 'в текст' : 'to body')})
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:
                          {(recordingDuration % 60).toString().padStart(2, '0')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={stopVoiceInput}
                        className="px-2 py-0.5 text-[10px] uppercase font-bold text-red-400 hover:text-white border border-red-900/60 bg-red-950/40 transition-colors cursor-pointer"
                      >
                        {nv.voiceStop}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleToggleVoiceInput('content')}
                  className={`px-2.5 py-1.5 border font-mono text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${
                    isListening && voiceTarget === 'content'
                      ? 'border-red-500 bg-red-950/40 text-red-400'
                      : 'border-neutral-800 bg-[#060608] text-neutral-400 hover:text-white hover:border-neutral-600'
                  }`}
                >
                  {isListening && voiceTarget === 'content' ? (
                    <>
                      <Square className="w-3 h-3 fill-current text-red-400" />
                      <span>{nv.voiceStop}</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3 h-3 text-neutral-400" />
                      <span>{nv.voiceDictation}</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      sound.tick(400);
                      setIsComposerOpen(false);
                      stopVoiceInput();
                    }}
                    className="px-3 py-1.5 border border-neutral-800 text-neutral-400 hover:text-white text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    {nv.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveNewNote()}
                    disabled={!title.trim() && !content.trim()}
                    className="px-3.5 py-1.5 bg-white text-black font-extrabold text-xs font-mono uppercase tracking-wider hover:bg-neutral-200 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Check className="w-3 h-3" />
                    <span>{nv.saveNote}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Notes Stream / Cards Grid */}
      {filteredAndSortedNotes.length === 0 ? (
        <div className="border border-dashed border-neutral-800 bg-[#08080a] py-14 px-6 text-center space-y-2.5 my-2">
          <div className="w-8 h-8 mx-auto mb-2 border border-neutral-800 bg-neutral-900/60 flex items-center justify-center text-neutral-500">
            <NotebookPen className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-200">
            {searchQuery ? nv.emptySearch : nv.emptyTitle}
          </h3>
          <p className="text-xs font-mono text-neutral-500 max-w-sm mx-auto">
            {searchQuery ? nv.emptySearchDesc : nv.emptyDesc}
          </p>
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 border border-neutral-700 text-white font-bold text-xs font-mono tracking-wider hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              {lang === 'uk' ? 'Очистити пошук' : 'Clear search'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                sound.tick(600);
                setIsComposerOpen(true);
                setTimeout(() => titleInputRef.current?.focus(), 100);
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-black font-extrabold text-xs font-mono uppercase tracking-wider hover:bg-neutral-200 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{nv.newNote}</span>
            </button>
          )}
        </div>
      ) : (
        <div
          className={`grid gap-3 ${
            viewMode === 'grid'
              ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-1'
          }`}
        >
          {filteredAndSortedNotes.map((note) => {
            const isEditing = editingNoteId === note.id;
            const noteColor = note.color || NOTE_COLOR_PRESETS[0].hex;

            if (isEditing) {
              return (
                <div
                  key={note.id}
                  className="border border-neutral-600 bg-[#0a0a0d] p-3.5 space-y-3 col-span-full shadow-lg font-mono"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                    <span className="text-xs font-mono font-bold uppercase text-white">
                      {nv.editNote}
                    </span>
                    <div className="flex items-center gap-1">
                      {NOTE_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.hex}
                          type="button"
                          onClick={() => setEditColor(preset.hex)}
                          style={{ backgroundColor: preset.hex }}
                          className={`w-3.5 h-3.5 transition-transform cursor-pointer ${
                            editColor === preset.hex ? 'scale-125 ring-1.5 ring-white' : 'opacity-60'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <input
                    ref={editTitleInputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveEdit();
                    }}
                    style={{ color: editColor }}
                    className="w-full bg-[#060608] border border-neutral-800 text-sm font-mono font-bold px-3 py-2 focus:outline-none focus:border-neutral-500"
                  />

                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveEdit();
                    }}
                    rows={4}
                    className="w-full bg-[#060608] border border-neutral-800 text-neutral-200 text-xs font-mono p-2.5 focus:outline-none focus:border-neutral-500 leading-relaxed"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceInput('content')}
                      className={`px-2.5 py-1 border text-xs font-mono uppercase flex items-center gap-1.5 cursor-pointer ${
                        isListening
                          ? 'border-red-500 bg-red-950/40 text-red-400'
                          : 'border-neutral-800 bg-[#060608] text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Mic className="w-3 h-3" />
                      <span>{isListening ? nv.voiceStop : nv.voiceDictation}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-2.5 py-1 border border-neutral-800 text-neutral-400 hover:text-white text-xs font-mono uppercase cursor-pointer"
                      >
                        {nv.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={!editTitle.trim() && !editContent.trim()}
                        className="px-3 py-1 bg-white text-black font-extrabold text-xs font-mono uppercase hover:bg-neutral-200 disabled:opacity-40 cursor-pointer"
                      >
                        {nv.updateNote}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={note.id}
                className={`group relative bg-[#09090d] border border-neutral-800 hover:border-neutral-700 transition-all p-3.5 flex flex-col justify-between ${
                  viewMode === 'list' ? 'sm:flex-row sm:items-center sm:gap-4' : ''
                }`}
                style={{
                  borderLeftColor: noteColor,
                  borderLeftWidth: '3px',
                }}
              >
                {/* Note Top Bar: Title, Dot, Micro Actions */}
                <div className={viewMode === 'list' ? 'flex-1 min-w-0' : ''}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 self-center"
                        style={{ backgroundColor: noteColor }}
                      />
                      <h3
                        className="text-xs sm:text-sm font-mono font-bold tracking-tight break-words line-clamp-2"
                        style={{ color: noteColor }}
                      >
                        {note.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => {
                          sound.tick(500);
                          onUpdateNote(note.id, { pinned: !note.pinned });
                        }}
                        title={note.pinned ? nv.unpinNote : nv.pinNote}
                        className={`p-1 hover:bg-neutral-800 transition-colors cursor-pointer ${
                          note.pinned ? 'text-amber-400' : 'text-neutral-500 hover:text-neutral-200'
                        }`}
                      >
                        {note.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyNote(note)}
                        title={nv.copyNote}
                        className="p-1 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        {copiedId === note.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartEdit(note)}
                        title={nv.editNote}
                        className="p-1 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteWithUndo(note)}
                        title={nv.deleteNote}
                        className="p-1 text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Note Body Text */}
                  <div className="text-neutral-300 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed py-0.5">
                    {note.content || (
                      <span className="italic text-neutral-600">
                        {lang === 'uk' ? '(Порожній вміст)' : '(No content)'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer: Crisp Timestamp and Edit Tag */}
                <div
                  className={`border-t border-neutral-800/60 flex items-center justify-between text-[10px] font-mono text-neutral-500 ${
                    viewMode === 'list'
                      ? 'sm:border-t-0 sm:border-l sm:pl-4 sm:ml-2 sm:flex-col sm:items-end sm:justify-center sm:gap-1 mt-2 sm:mt-0 pt-2 sm:pt-0 shrink-0'
                      : 'mt-3 pt-2.5'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5 text-neutral-500" />
                    <span>{formatDate(note.createdAt)}</span>
                  </div>

                  {note.updatedAt && (
                    <div className="flex items-center gap-1 text-[9px] text-neutral-600">
                      <Clock className="w-2 h-2" />
                      <span>{lang === 'uk' ? 'Ред.' : 'Edited'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Undo Toast for deleted note */}
      <AnimatePresence>
        {recentlyDeletedNote && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20, transition: { duration: 0.15 } }}
            className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 border border-neutral-700 px-4 py-2.5 flex items-center gap-3 shadow-2xl text-xs font-mono"
          >
            <span className="text-neutral-300">
              {lang === 'uk' ? 'Нотатку видалено:' : 'Note deleted:'} "{recentlyDeletedNote.title.slice(0, 24)}{recentlyDeletedNote.title.length > 24 ? '...' : ''}"
            </span>
            <button
              type="button"
              onClick={handleRestoreDeletedNote}
              className="text-white font-extrabold underline hover:text-neutral-300 cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.undo}</span>
            </button>
            <button
              type="button"
              onClick={() => setRecentlyDeletedNote(null)}
              className="text-neutral-500 hover:text-white ml-1 font-bold text-xs p-0.5 cursor-pointer transition-colors"
              title={lang === 'uk' ? 'Закрити' : 'Close'}
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
