import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { NotepadNote, NoteSortOption } from '../types';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import { karkasApiFetch } from '../utils/desktopApi';
import { loadNotepadDrafts, markNotepadDraftCleanup, noteDraftBase, noteDraftMatches, saveNotepadDrafts, type NoteDraftBase } from '../utils/notepadDrafts';
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
  ownerId?: string | null;
  lang: Language;
  notes: NotepadNote[];
  onAddNote: (note: Omit<NotepadNote, 'id' | 'createdAt'>) => boolean;
  onUpdateNote: (id: string, updates: Partial<NotepadNote>) => boolean;
  onDeleteNote: (id: string) => void;
  onRestoreNote: (note: NotepadNote) => void;
  storageError?: boolean;
}

interface NoteVoiceSession {
  target: 'content' | 'title';
  noteId: string | null;
  abortController: AbortController;
  stopping: boolean;
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
  ownerId = null,
  lang,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onRestoreNote,
  storageError = false,
}) => {
  const t = TRANSLATIONS[lang];
  const nv = t.notepadView;
  const [initialDrafts] = useState(() => {
    try { return loadNotepadDrafts(localStorage, ownerId); }
    catch { return loadNotepadDrafts(undefined, ownerId); }
  });
  const [draftStorageError, setDraftStorageError] = useState(!initialDrafts.canPersist);
  const [draftCanPersist, setDraftCanPersist] = useState(initialDrafts.canPersist);
  const [draftSaveAttempt, setDraftSaveAttempt] = useState(0);
  const [draftCleanupError, setDraftCleanupError] = useState(Boolean(initialDrafts.cleanupPending));
  const draftCleanupPending = useRef(Boolean(initialDrafts.cleanupPending));

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<NoteSortOption>('NEWEST');
  const [selectedColorFilter, setSelectedColorFilter] = useState<string | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // New Note Composer state
  const [title, setTitle] = useState(initialDrafts.drafts.composer?.title || '');
  const [content, setContent] = useState(initialDrafts.drafts.composer?.content || '');
  const [selectedColor, setSelectedColor] = useState<string>(initialDrafts.drafts.composer?.color || NOTE_COLOR_PRESETS[0].hex);
  const [isComposerOpen, setIsComposerOpen] = useState(Boolean(initialDrafts.drafts.composer));
  const [voiceTarget, setVoiceTarget] = useState<'content' | 'title'>('content');

  // Inline edit state
  const [hasEditDraft, setHasEditDraft] = useState(Boolean(initialDrafts.drafts.edit));
  const [editBase, setEditBase] = useState<NoteDraftBase | null>(initialDrafts.drafts.edit?.base || null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(() => {
    const base = initialDrafts.drafts.edit?.base;
    return base && noteDraftMatches(base, notes.find(note => note.id === base.id)) ? base.id : null;
  });
  const [editTitle, setEditTitle] = useState(initialDrafts.drafts.edit?.title || '');
  const [editContent, setEditContent] = useState(initialDrafts.drafts.edit?.content || '');
  const [editColor, setEditColor] = useState<string>(initialDrafts.drafts.edit?.color || NOTE_COLOR_PRESETS[0].hex);

  // Copied feedback state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Undo delete safety state
  const [recentlyDeletedNote, setRecentlyDeletedNote] = useState<NotepadNote | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NotepadNote | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(() => initialDrafts.recovered
    ? initialDrafts.canPersist
      ? (lang === 'uk' ? 'Доступний текст чернеток відновлено. Початкову пошкоджену копію збережено окремо.' : 'Available draft text was recovered. The original damaged copy was kept separately.')
      : (lang === 'uk' ? 'Доступний текст чернеток відновлено. Початкову пошкоджену копію не змінено.' : 'Available draft text was recovered. The original damaged copy was left unchanged.')
    : initialDrafts.drafts.composer || initialDrafts.drafts.edit
      ? (lang === 'uk' ? 'Незбережені зміни відновлено з чернеток.' : 'Unsaved changes were restored from drafts.') : null);
  const [noteSaveError, setNoteSaveError] = useState(false);
  const newNoteSaveLock = useRef(false);
  const editSaveLock = useRef(false);
  const voiceDraftWriteSequenceRef = useRef(0);
  const pendingVoiceDraftWriteRef = useRef<number | null>(null);
  const [committedVoiceDraftRevision, setCommittedVoiceDraftRevision] = useState(0);
  const editRecoveryRef = useRef<HTMLDivElement | null>(null);
  const composerToggleRef = useRef<HTMLButtonElement | null>(null);
  const editedNote = editBase ? notes.find(note => note.id === editBase.id) : undefined;
  const editDraftIsCurrent = hasEditDraft && noteDraftMatches(editBase, editedNote);

  // Persist each committed text change before navigation can unmount this view.
  // Composer and edit drafts are independent; saving one never clears the other.
  useLayoutEffect(() => {
    const drafts = {
      composer: title || content ? { title, content, color: selectedColor } : null,
      edit: hasEditDraft ? { title: editTitle, content: editContent, color: editColor, base: editBase } : null,
    };
    let saved = false;
    try { saved = saveNotepadDrafts(localStorage, drafts, draftCanPersist, ownerId); }
    catch { saved = saveNotepadDrafts(undefined, drafts, false, ownerId); }
    setDraftStorageError(!saved);
    setDraftCleanupError(draftCleanupPending.current && !saved);
    if (saved) draftCleanupPending.current = false;
    // saveNotepadDrafts installs the session unload guard on a failed write.
    // An older render must not release protection for newer accepted speech.
    if (pendingVoiceDraftWriteRef.current === committedVoiceDraftRevision) pendingVoiceDraftWriteRef.current = null;
  }, [ownerId, title, content, selectedColor, hasEditDraft, editTitle, editContent, editColor, editBase, draftCanPersist, draftSaveAttempt, committedVoiceDraftRevision]);

  useLayoutEffect(() => {
    if (title || content) newNoteSaveLock.current = false;
  }, [title, content]);
  useLayoutEffect(() => {
    if (hasEditDraft) editSaveLock.current = false;
  }, [hasEditDraft, editTitle, editContent, editColor]);

  useEffect(() => {
    if (pendingDelete) deleteDialogRef.current?.showModal();
    else deleteDialogRef.current?.close();
  }, [pendingDelete]);

  // Voice recording state
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isVoiceStarting, setIsVoiceStarting] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceSessionRef = useRef<NoteVoiceSession | null>(null);
  const voiceMountedRef = useRef(true);

  useLayoutEffect(() => {
    const protectUnfinishedVoiceWork = (event: BeforeUnloadEvent) => {
      if (!voiceSessionRef.current && pendingVoiceDraftWriteRef.current === null) return;
      event.preventDefault();
      event.returnValue = '';
    };
    // Native update preparation dispatches this same cancelable event.
    // Staying leaves the recording/transcription session running unchanged.
    window.addEventListener('beforeunload', protectUnfinishedVoiceWork);
    return () => window.removeEventListener('beforeunload', protectUnfinishedVoiceWork);
  }, []);

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
    voiceMountedRef.current = true;
    return () => {
      voiceMountedRef.current = false;
      cancelVoiceInput();
    };
  }, []);

  // Keyboard navigation shortcuts within NotepadView
  useEffect(() => {
    const handleLocalKeyDown = (e: KeyboardEvent) => {
      if (pendingDelete) return;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isListening) {
          stopVoiceInput();
          return;
        }
        if (editingNoteId) {
          handlePauseEdit();
          return;
        }
        if (isComposerOpen) {
          handleCloseComposer();
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
  }, [isListening, editingNoteId, isComposerOpen, searchQuery, pendingDelete]);

  const isVoiceBusy = () => voiceSessionRef.current !== null;

  const isCurrentVoiceSession = (session: NoteVoiceSession) =>
    voiceMountedRef.current && voiceSessionRef.current === session;

  const releaseMicrophone = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const finishVoiceSession = (session: NoteVoiceSession) => {
    if (!isCurrentVoiceSession(session)) return;
    voiceSessionRef.current = null;
    recognitionRef.current = null;
    mediaRecorderRef.current = null;
    releaseMicrophone();
    setIsListening(false);
    setIsVoiceStarting(false);
    setIsTranscribing(false);
  };

  // Cancellation invalidates callbacks before stopping devices. A delayed permission
  // prompt or desktop transcription response must never write into another draft.
  const cancelVoiceInput = () => {
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    session?.abortController.abort();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch {}
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    releaseMicrophone();
    if (voiceMountedRef.current) {
      setIsListening(false);
      setIsVoiceStarting(false);
      setIsTranscribing(false);
    }
  };

  const stopVoiceInput = () => {
    const session = voiceSessionRef.current;
    if (!session || session.stopping) return;
    session.stopping = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        setIsTranscribing(true);
      } catch { finishVoiceSession(session); }
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        setIsTranscribing(true);
        mediaRecorderRef.current.stop();
      } catch { finishVoiceSession(session); }
      releaseMicrophone();
    } else {
      cancelVoiceInput();
    }
    setIsListening(false);
  };

  const transcribeRecordedAudio = async (blob: Blob, session: NoteVoiceSession) => {
    if (!isCurrentVoiceSession(session)) return;
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      reader.readAsDataURL(blob);
      const audioBase64 = await base64Promise;
      if (!isCurrentVoiceSession(session)) return;

      const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      const customApiKey = localStorage.getItem('karkas_custom_api_key') || undefined;
      const customModel = localStorage.getItem('karkas_custom_model') || undefined;
      const res = await karkasApiFetch('/api/ai/transcribe-audio', {
        method: 'POST',
        signal: session.abortController.signal,
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
        if (!isCurrentVoiceSession(session)) return;
        if (data.text) {
          applyTranscribedText(data.text.trim(), session);
          sound.tick(800);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Мовлення не виявлено. Спробуйте ще раз.' : 'No speech detected. Please try again.');
          sound.tick(300);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (!isCurrentVoiceSession(session)) return;
        setVoiceNotice(errData.error || (lang === 'uk' ? 'Помилка транскрипції аудіо' : 'Audio transcription error'));
        sound.tick(300);
      }
    } catch (err: any) {
      if (!isCurrentVoiceSession(session)) return;
      console.error('Audio transcription error:', err);
      setVoiceNotice(lang === 'uk' ? 'Помилка розпізнавання аудіо' : 'Audio transcription error');
      sound.tick(300);
    } finally {
      finishVoiceSession(session);
    }
  };

  const applyTranscribedText = (spoken: string, session: NoteVoiceSession) => {
    const text = spoken.trim();
    if (!text || !isCurrentVoiceSession(session)) return;
    const revision = ++voiceDraftWriteSequenceRef.current;
    pendingVoiceDraftWriteRef.current = revision;
    setCommittedVoiceDraftRevision(revision);
    if (session.noteId) {
      setEditContent((prev) => (prev ? `${prev} ${text}` : text));
      return;
    }
    if (session.target === 'title') {
      setTitle((prev) => (prev ? `${prev} ${text}` : text));
    } else {
      setContent((prev) => (prev ? `${prev} ${text}` : text));
    }
  };

  const startMediaRecorderFallback = async (session: NoteVoiceSession) => {
    if (!isCurrentVoiceSession(session)) return;
    setIsVoiceStarting(true);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceNotice(lang === 'uk' ? 'Мікрофон не підтримується цим середовищем' : 'Microphone is not supported');
      sound.tick(300);
      finishVoiceSession(session);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isCurrentVoiceSession(session)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const audioChunks: Blob[] = [];

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      }

      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: 32000,
      };
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (isCurrentVoiceSession(session) && e.data.size > 0) audioChunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (!isCurrentVoiceSession(session)) return;
        setIsListening(false);
        mediaRecorderRef.current = null;
        releaseMicrophone();
        const audioBlob = new Blob(audioChunks, { type: recorder.mimeType || 'audio/webm' });
        if (audioBlob.size > 200) {
          await transcribeRecordedAudio(audioBlob, session);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Запис занадто короткий' : 'Recording too short');
          sound.tick(300);
          finishVoiceSession(session);
        }
      };

      recorder.onerror = () => {
        if (!isCurrentVoiceSession(session)) return;
        setVoiceNotice(lang === 'uk' ? 'Помилка запису аудіо' : 'Audio recording error');
        cancelVoiceInput();
      };

      recorder.start(250);
      setIsVoiceStarting(false);
      setIsListening(true);
      sound.tick(750);
    } catch (err) {
      if (!isCurrentVoiceSession(session)) return;
      console.error('Microphone access failed:', err);
      setVoiceNotice(lang === 'uk' ? 'Доступ до мікрофона заблоковано' : 'Microphone access blocked');
      sound.tick(300);
      finishVoiceSession(session);
    }
  };

  const handleToggleVoiceInput = (target: 'content' | 'title' = 'content', noteId: string | null = null) => {
    // The ref guards rapid clicks before React commits the busy state.
    if (voiceSessionRef.current) {
      if (isListening) {
        sound.tick(400);
        stopVoiceInput();
      }
      return;
    }

    const session: NoteVoiceSession = { target, noteId, abortController: new AbortController(), stopping: false };
    voiceSessionRef.current = session;
    setVoiceTarget(target);
    setIsVoiceStarting(true);
    setVoiceNotice(null);

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
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;

          recognition.onstart = () => {
            if (!isCurrentVoiceSession(session) || recognitionRef.current !== recognition) return;
            setIsVoiceStarting(false);
            setIsListening(true);
            sound.tick(750);
          };

          recognition.onresult = (event: any) => {
            if (!isCurrentVoiceSession(session) || recognitionRef.current !== recognition) return;
            const finalTranscripts: string[] = [];
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                finalTranscripts.push(transcript.trim());
              }
            }
            // Append finalized speech to the latest text so typing while dictating
            // is preserved instead of replacing it with a stale initial value.
            applyTranscribedText(finalTranscripts.join(' '), session);
          };

          recognition.onerror = (event: any) => {
            if (!isCurrentVoiceSession(session) || recognitionRef.current !== recognition) return;
            console.warn('Speech recognition error, falling back to MediaRecorder:', event.error);
            recognitionRef.current = null;
            try { recognition.abort(); } catch {}
            setIsListening(false);
            if (event.error !== 'no-speech' && !session.stopping) {
              startMediaRecorderFallback(session);
            } else {
              finishVoiceSession(session);
            }
          };

          recognition.onend = () => {
            if (recognitionRef.current !== recognition) return;
            finishVoiceSession(session);
          };

          recognitionRef.current = recognition;
          recognition.start();
          return;
        } catch (e) {
          const recognition = recognitionRef.current;
          recognitionRef.current = null;
          try { recognition?.abort(); } catch {}
          console.warn('SpeechRecognition failed, falling back to MediaRecorder', e);
        }
      }
    }

    startMediaRecorderFallback(session);
  };

  const handleCloseComposer = () => {
    cancelVoiceInput();
    setIsComposerOpen(false);
    setTimeout(() => composerToggleRef.current?.focus(), 0);
  };

  const handleSaveNewNote = () => {
    if (isVoiceBusy() || newNoteSaveLock.current) return;
    if (!title.trim() && !content.trim()) return;
    newNoteSaveLock.current = true;
    const finalTitle = title.trim() || (lang === 'uk' ? 'Без назви' : 'Untitled note');
    let saved = false;
    try {
      saved = onAddNote({ title: finalTitle, content: content.trim(), color: selectedColor, pinned: false });
    } catch { /* Keep the draft if the caller cannot commit the saved note. */ }
    if (!saved) {
      newNoteSaveLock.current = false;
      setNoteSaveError(true);
      return;
    }
    sound.tick(700);
    setNoteSaveError(false);
    markNotepadDraftCleanup(ownerId);
    draftCleanupPending.current = true;
    setTitle('');
    setContent('');
    setSelectedColor(NOTE_COLOR_PRESETS[0].hex);
    setIsComposerOpen(false);
    cancelVoiceInput();
    setTimeout(() => composerToggleRef.current?.focus(), 0);
  };

  const handleDiscardNewDraft = () => {
    if ((title || content) && !window.confirm(lang === 'uk' ? 'Видалити чернетку нової нотатки? Незбережений текст буде втрачено.' : 'Discard the new note draft? Unsaved text will be lost.')) return;
    cancelVoiceInput();
    markNotepadDraftCleanup(ownerId);
    draftCleanupPending.current = true;
    setTitle('');
    setContent('');
    setSelectedColor(NOTE_COLOR_PRESETS[0].hex);
    setIsComposerOpen(false);
    setNoteSaveError(false);
    setTimeout(() => composerToggleRef.current?.focus(), 0);
  };

  const handleStartEdit = (note: NotepadNote) => {
    if (hasEditDraft) {
      if (editBase?.id === note.id && noteDraftMatches(editBase, note)) {
        setEditingNoteId(note.id);
        setSearchQuery('');
        setSelectedColorFilter('ALL');
        setTimeout(() => editTitleInputRef.current?.focus(), 100);
      } else {
        setActionNotice(lang === 'uk' ? 'Спочатку збережіть або видаліть наявну чернетку редагування.' : 'Save or discard the existing edit draft first.');
        if (editingNoteId && editDraftIsCurrent) editTitleInputRef.current?.focus();
        else editRecoveryRef.current?.focus();
      }
      return;
    }
    cancelVoiceInput();
    setActionNotice(null);
    setNoteSaveError(false);
    sound.tick(500);
    setHasEditDraft(true);
    setEditBase(noteDraftBase(note));
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color || NOTE_COLOR_PRESETS[0].hex);
    setTimeout(() => {
      editTitleInputRef.current?.focus();
    }, 100);
  };

  const handlePauseEdit = () => {
    sound.tick(400);
    setEditingNoteId(null);
    cancelVoiceInput();
    setTimeout(() => editRecoveryRef.current?.focus(), 100);
  };

  const clearEditDraft = () => {
    markNotepadDraftCleanup(ownerId);
    draftCleanupPending.current = true;
    setHasEditDraft(false);
    setEditBase(null);
    setEditingNoteId(null);
    setEditTitle('');
    setEditContent('');
    setEditColor(NOTE_COLOR_PRESETS[0].hex);
    cancelVoiceInput();
    setTimeout(() => composerToggleRef.current?.focus(), 0);
  };

  const handleRetryDraftSave = () => {
    let canPersist = false;
    try { canPersist = loadNotepadDrafts(localStorage, ownerId).canPersist; }
    catch { /* Never overwrite a draft store that cannot be read safely. */ }
    setDraftCanPersist(canPersist);
    setDraftSaveAttempt(attempt => attempt + 1);
  };

  const handleDiscardEdit = () => {
    if (!window.confirm(lang === 'uk' ? 'Видалити чернетку редагування? Збережена нотатка залишиться без цих змін.' : 'Discard the edit draft? These changes will not be added to the saved note.')) return;
    clearEditDraft();
    setNoteSaveError(false);
  };

  const handleSaveEdit = () => {
    if (isVoiceBusy() || editSaveLock.current || !hasEditDraft) return;
    if (!editTitle.trim() && !editContent.trim()) return;
    if (!editBase || !noteDraftMatches(editBase, notes.find(note => note.id === editBase.id))) {
      setEditingNoteId(null);
      cancelVoiceInput();
      setTimeout(() => editRecoveryRef.current?.focus(), 100);
      return;
    }
    editSaveLock.current = true;
    let saved = false;
    try {
      saved = onUpdateNote(editBase.id, {
        title: editTitle.trim() || (lang === 'uk' ? 'Без назви' : 'Untitled note'),
        content: editContent.trim(), color: editColor, updatedAt: Date.now(),
      });
    } catch { /* An unsuccessful save must leave the edit draft intact. */ }
    if (!saved) {
      editSaveLock.current = false;
      setNoteSaveError(true);
      return;
    }
    sound.tick(700);
    setNoteSaveError(false);
    clearEditDraft();
  };

  const handleSaveRecoveredEdit = () => {
    if (isVoiceBusy() || editSaveLock.current || !hasEditDraft || (!editTitle.trim() && !editContent.trim())) return;
    editSaveLock.current = true;
    let saved = false;
    try {
      saved = onAddNote({
        title: editTitle.trim() || (lang === 'uk' ? 'Без назви' : 'Untitled note'),
        content: editContent.trim(), color: editColor, pinned: false,
      });
    } catch { /* Keep this recovery draft independent from the new-note draft. */ }
    if (!saved) {
      editSaveLock.current = false;
      setNoteSaveError(true);
      return;
    }
    sound.tick(700);
    setNoteSaveError(false);
    clearEditDraft();
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const note = notes.find((item) => item.id === pendingDelete.id);
    setPendingDelete(null);
    if (!note) return;
    sound.tick(400);
    setRecentlyDeletedNote(note);
    onDeleteNote(note.id);
  };

  const handleRestoreDeletedNote = () => {
    if (!recentlyDeletedNote) return;
    sound.tick(700);
    onRestoreNote(recentlyDeletedNote);
    setRecentlyDeletedNote(null);
  };

  const handleCopyNote = async (note: NotepadNote) => {
    sound.tick(600);
    const textToCopy = `${note.title}\n\n${note.content}`.trim();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      setActionNotice(lang === 'uk' ? 'Не вдалося скопіювати нотатку. Перевірте дозвіл на доступ до буфера обміну.' : 'Could not copy the note. Check clipboard permission.');
      return;
    }
    setActionNotice(null);
    setCopiedId(note.id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === note.id ? null : curr));
    }, 1800);
  };

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp);
    // The year is noise for this year's notes; older notes keep it.
    return d.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
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
  const hasFilters = Boolean(searchQuery.trim()) || selectedColorFilter !== 'ALL';

  const segment = (selected: boolean) => `inline-flex min-h-11 sm:min-h-8 items-center gap-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${selected ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`;
  const noteAction = 'inline-flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200';

  return (
    <div className="w-full space-y-5">
      {storageError && (
        <p role="alert" className="border border-rose-800 bg-rose-950/20 p-3 text-xs text-rose-200">
          {lang === 'uk' ? 'Не вдалося зберегти нотатки на пристрої. Скопіюйте важливий текст перед закриттям додатка.' : 'Notes could not be saved on this device. Copy important text before closing the app.'}
        </p>
      )}
      {draftStorageError && (
        <div role="alert" className="border border-rose-800 bg-rose-950/20 p-3 space-y-2 text-xs text-rose-200">
          <p>{draftCleanupError
            ? (lang === 'uk' ? 'Стару чернетку не вдалося прибрати зі сховища. У цьому сеансі вона не відновиться; після перезапуску може з’явитися знову. Повторіть збереження чернеток перед виходом.' : 'The old draft could not be removed from storage. It will not return in this session, but may return after restarting. Retry saving drafts before quitting.')
            : (lang === 'uk' ? 'Чернетки доступні в цьому сеансі, але не збережені на пристрої. Скопіюйте важливий незбережений текст перед перезапуском або виходом.' : 'Drafts remain available in this session but are not saved on this device. Copy important unsaved text before restarting or quitting.')}</p>
          <button type="button" onClick={handleRetryDraftSave} className="min-h-11 border border-rose-700 px-3 py-2 text-xs text-rose-100 hover:bg-rose-950/50">
            {lang === 'uk' ? 'Повторити збереження чернеток' : 'Retry saving drafts'}
          </button>
        </div>
      )}
      {noteSaveError && (
        <p role="alert" className="border border-rose-800 bg-rose-950/20 p-3 text-xs text-rose-200">
          {lang === 'uk' ? 'Нотатку не збережено. Введений текст залишився у формі; спробуйте зберегти ще раз.' : 'The note was not saved. Your text remains in the form; try saving again.'}
        </p>
      )}
      {actionNotice && (
        <div role="status" className="flex items-center justify-between gap-3 border border-amber-800 bg-amber-950/20 p-3 text-xs text-amber-200">
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice(null)} aria-label={lang === 'uk' ? 'Закрити' : 'Close'}><X className="w-4 h-4" /></button>
        </div>
      )}
      {!isComposerOpen && (isVoiceStarting || isListening || isTranscribing || voiceNotice) && (
        <p role="status" className="border border-neutral-700 p-3 text-xs text-neutral-300">
          {voiceNotice || (isVoiceStarting
            ? (lang === 'uk' ? 'Запуск мікрофона…' : 'Starting microphone…')
            : isTranscribing
            ? (lang === 'uk' ? 'Розпізнавання голосу… Дочекайтеся завершення перед збереженням.' : 'Transcribing… Wait for completion before saving.')
            : (lang === 'uk' ? 'Триває запис. Зупиніть його перед збереженням.' : 'Recording. Stop before saving.'))}
        </p>
      )}
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
            className="w-full pl-9 pr-8 py-2.5 bg-[#09090d] border border-neutral-800 text-neutral-200 placeholder-neutral-500 text-base leading-[1.6] font-sans focus:outline-none focus:border-neutral-500 transition-colors shadow-inner"
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
          ref={composerToggleRef}
          type="button"
          onClick={() => {
            sound.tick(600);
            cancelVoiceInput();
            setIsComposerOpen((prev) => !prev);
            setTimeout(() => {
              if (!isComposerOpen) titleInputRef.current?.focus();
            }, 100);
          }}
          className="px-3.5 py-2.5 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs font-sans tracking-wider uppercase transition-all flex items-center gap-1.5 shrink-0 active:scale-95 cursor-pointer shadow-sm"
        >
          {isComposerOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>{isComposerOpen ? (lang === 'uk' ? 'Закрити' : 'Close') : nv.newNote}</span>
        </button>
      </div>

      {/* 2. Filters, sorting and view: one quiet rail of segmented controls. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={lang === 'uk' ? 'Фільтр за кольором' : 'Filter by color'} className="inline-flex flex-wrap items-center gap-0.5 border border-neutral-800 p-0.5">
            <button
              type="button"
              aria-pressed={selectedColorFilter === 'ALL'}
              onClick={() => {
                sound.tick(500);
                setSelectedColorFilter('ALL');
              }}
              className={segment(selectedColorFilter === 'ALL')}
            >
              <span className="sm:hidden">{lang === 'uk' ? 'Всі' : 'All'}</span>
              <span className="hidden sm:inline">{nv.allColors}</span>
              <span className="font-mono font-normal tabular-nums text-neutral-500">{notes.length}</span>
            </button>
            {NOTE_COLOR_PRESETS.map((c) => {
              const isSelected = selectedColorFilter === c.hex;
              return (
                <button
                  key={c.hex}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => {
                    sound.tick(400);
                    setSelectedColorFilter(isSelected ? 'ALL' : c.hex);
                  }}
                  className={`inline-flex h-11 w-7 sm:h-8 items-center justify-center transition-colors ${isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-900'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-3 w-3 transition-opacity ${isSelected ? 'ring-1 ring-white ring-offset-2 ring-offset-neutral-800' : 'opacity-70'}`}
                    style={{ backgroundColor: c.hex }}
                  />
                </button>
              );
            })}
          </div>

          {pinnedCount > 0 && (
            <span title={lang === 'uk' ? 'Закріплені нотатки' : 'Pinned notes'} className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-neutral-500">
              <Pin className="h-3 w-3" aria-hidden="true" />
              {pinnedCount}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={nv.sortLabel.replace(':', '')} className="inline-flex items-center gap-0.5 border border-neutral-800 p-0.5">
            <ArrowUpDown className="mx-1.5 h-3.5 w-3.5 text-neutral-500" aria-hidden="true" />
            {(['NEWEST', 'OLDEST', 'DATE'] as NoteSortOption[]).map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={sortOption === opt}
                onClick={() => {
                  sound.tick(500);
                  setSortOption(opt);
                }}
                className={segment(sortOption === opt)}
              >
                {opt === 'NEWEST' ? nv.sortNewest : opt === 'OLDEST' ? nv.sortOldest : nv.sortDate}
              </button>
            ))}
          </div>

          {/* On phones the grid is one column anyway, so the view switch only appears from sm. */}
          <div role="group" aria-label={lang === 'uk' ? 'Вигляд' : 'View'} className="hidden sm:inline-flex items-center gap-0.5 border border-neutral-800 p-0.5">
            <button
              type="button"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              aria-label={lang === 'uk' ? 'Сіткою' : 'Grid view'}
              title={lang === 'uk' ? 'Сіткою' : 'Grid view'}
              className={`${segment(viewMode === 'grid')} px-2`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              aria-label={lang === 'uk' ? 'Списком' : 'List view'}
              title={lang === 'uk' ? 'Списком' : 'List view'}
              className={`${segment(viewMode === 'list')} px-2`}
            >
              <List className="h-4 w-4" aria-hidden="true" />
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
            <div className="border border-neutral-800 bg-[#0a0a0d] p-4 font-sans space-y-3 shadow-lg">
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
                    aria-label={lang === 'uk' ? 'Назва нової нотатки' : 'New note title'}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveNewNote();
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        contentTextareaRef.current?.focus();
                      }
                    }}
                    placeholder={nv.titlePlaceholder}
                    style={{ color: selectedColor }}
                    className="w-full bg-[#060608] border border-neutral-800 text-base leading-[1.6] font-sans font-bold pl-3 pr-9 py-2 focus:outline-none focus:border-neutral-500 transition-colors"
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
                  aria-label={lang === 'uk' ? 'Текст нової нотатки' : 'New note text'}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (!e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSaveNewNote(); }
                  }}
                  placeholder={nv.contentPlaceholder}
                  rows={3}
                  className="w-full bg-[#060608] border border-neutral-800 text-neutral-200 placeholder:text-neutral-500 text-base leading-[1.6] font-sans p-3 focus:outline-none focus:border-neutral-500 transition-colors"
                />
              </div>

              {/* Voice Recording Live Feedback */}
              {(isVoiceStarting || isListening || isTranscribing || voiceNotice) && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#060608] border border-neutral-800 text-xs font-sans">
                  {voiceNotice ? (
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span className="text-[11px]">{voiceNotice}</span>
                    </div>
                  ) : isTranscribing || isVoiceStarting ? (
                    <div className="flex items-center gap-2 text-neutral-300">
                      <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                      <span className="text-[11px]">{isVoiceStarting ? (lang === 'uk' ? 'Запуск мікрофона…' : 'Starting microphone…') : (lang === 'uk' ? 'ШІ транскрибує голос...' : 'Transcribing voice...')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[11px] text-red-400 font-bold uppercase tracking-wider">
                          {nv.voiceListening} ({voiceTarget === 'title' ? (lang === 'uk' ? 'в заголовок' : 'to title') : (lang === 'uk' ? 'в текст' : 'to body')})
                        </span>
                        <span className="text-[10px] text-neutral-400 font-sans">
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleToggleVoiceInput('content')}
                  className={`px-2.5 py-1.5 border font-sans text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${
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

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={handleDiscardNewDraft} className="min-h-11 px-3 py-1.5 border border-neutral-800 text-neutral-400 hover:text-rose-300 text-xs font-sans transition-colors cursor-pointer">
                    {lang === 'uk' ? 'Видалити чернетку' : 'Discard draft'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseComposer}
                    className="min-h-11 px-3 py-1.5 border border-neutral-800 text-neutral-400 hover:text-white text-xs font-sans uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    {lang === 'uk' ? 'Закрити' : 'Close'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveNewNote()}
                    disabled={isVoiceStarting || isListening || isTranscribing || (!title.trim() && !content.trim())}
                    className="min-h-11 px-3.5 py-1.5 bg-white text-black font-extrabold text-xs font-sans uppercase tracking-wider hover:bg-neutral-200 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Check className="w-3 h-3" />
                    <span>{nv.saveNote}</span>
                  </button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-neutral-500">
                {draftStorageError
                  ? (lang === 'uk' ? 'Чернетка залишиться доступною до завершення цього сеансу.' : 'The draft remains available until this session ends.')
                  : (lang === 'uk' ? 'Закриття й перехід до іншого розділу зберігають чернетку.' : 'Closing this form or moving to another section keeps the draft.')}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {hasEditDraft && (!editingNoteId || !editDraftIsCurrent || !filteredAndSortedNotes.some(note => note.id === editingNoteId)) && (
        <div ref={editRecoveryRef} tabIndex={-1} role="region" aria-labelledby="notepad-edit-draft-title" className="border border-amber-800 bg-[#0a0a0d] p-4 space-y-3 font-sans">
          <h2 id="notepad-edit-draft-title" className="text-sm font-bold text-neutral-100">
            {lang === 'uk' ? 'Чернетка редагування' : 'Edit draft'}
          </h2>
          <p role="status" className="text-xs leading-relaxed text-neutral-300">
            {editDraftIsCurrent
              ? (lang === 'uk' ? 'Незбережені зміни залишилися в чернетці. Продовжіть редагування або видаліть чернетку.' : 'Your unsaved changes remain in this draft. Resume editing or discard the draft.')
              : editedNote
                ? (lang === 'uk' ? 'Збережена нотатка змінилася після початку редагування. Чернетка її не перезапише; збережіть цей текст як нову нотатку.' : 'The saved note changed after editing began. This draft will not overwrite it; save this text as a new note.')
                : (lang === 'uk' ? 'Початкової нотатки немає або її не вдалося визначити. Відновлений текст можна зберегти як нову нотатку.' : 'The original note is missing or could not be identified. You can save the recovered text as a new note.')}
          </p>
          <label htmlFor="notepad-edit-draft-name" className="block text-xs text-neutral-400">
            {lang === 'uk' ? 'Назва з чернетки' : 'Draft title'}
            <input id="notepad-edit-draft-name" value={editTitle} onChange={event => setEditTitle(event.target.value)} className="mt-1 w-full bg-[#060608] border border-neutral-800 px-3 py-2 text-base text-neutral-100 focus:outline-none focus:border-neutral-500" />
          </label>
          <label htmlFor="notepad-edit-draft-content" className="block text-xs text-neutral-400">
            {lang === 'uk' ? 'Текст з чернетки' : 'Draft text'}
            <textarea id="notepad-edit-draft-content" value={editContent} onChange={event => setEditContent(event.target.value)} rows={4} className="mt-1 w-full bg-[#060608] border border-neutral-800 px-3 py-2 text-base leading-[1.6] text-neutral-200 focus:outline-none focus:border-neutral-500" />
          </label>
          <div className="flex flex-wrap gap-2">
            {editDraftIsCurrent && editedNote ? (
              <button type="button" onClick={() => handleStartEdit(editedNote)} className="min-h-11 bg-white px-3 py-2 text-xs font-bold text-black hover:bg-neutral-200">
                {lang === 'uk' ? 'Продовжити редагування' : 'Resume editing'}
              </button>
            ) : (
              <button type="button" onClick={handleSaveRecoveredEdit} disabled={isVoiceStarting || isListening || isTranscribing || (!editTitle.trim() && !editContent.trim())} className="min-h-11 bg-white px-3 py-2 text-xs font-bold text-black hover:bg-neutral-200 disabled:opacity-40">
                {lang === 'uk' ? 'Зберегти як нову нотатку' : 'Save as a new note'}
              </button>
            )}
            <button type="button" onClick={handleDiscardEdit} className="min-h-11 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:text-rose-300">
              {lang === 'uk' ? 'Видалити чернетку' : 'Discard draft'}
            </button>
          </div>
        </div>
      )}

      {/* 3. Notes Stream / Cards Grid */}
      {filteredAndSortedNotes.length === 0 ? (
        <div className="border border-dashed border-neutral-800 bg-[#08080a] py-14 px-6 text-center space-y-2.5 my-2">
          <div className="w-8 h-8 mx-auto mb-2 border border-neutral-800 bg-neutral-900/60 flex items-center justify-center text-neutral-500">
            <NotebookPen className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-sans font-bold uppercase tracking-wider text-neutral-200">
            {hasFilters ? nv.emptySearch : nv.emptyTitle}
          </h3>
          <p className="text-xs font-sans text-neutral-500 max-w-sm mx-auto">
            {hasFilters ? nv.emptySearchDesc : nv.emptyDesc}
          </p>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setSelectedColorFilter('ALL'); }}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 border border-neutral-700 text-white font-bold text-xs font-sans tracking-wider hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              {lang === 'uk' ? 'Скинути фільтри' : 'Reset filters'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                sound.tick(600);
                setIsComposerOpen(true);
                setTimeout(() => titleInputRef.current?.focus(), 100);
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-black font-extrabold text-xs font-sans uppercase tracking-wider hover:bg-neutral-200 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{nv.newNote}</span>
            </button>
          )}
        </div>
      ) : (
        <div
          className={`grid gap-4 ${
            viewMode === 'grid'
              ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-1'
          }`}
        >
          {filteredAndSortedNotes.map((note) => {
            const isEditing = editingNoteId === note.id && editDraftIsCurrent;
            const noteColor = note.color || NOTE_COLOR_PRESETS[0].hex;

            if (isEditing) {
              return (
                <div
                  key={note.id}
                  className="border border-neutral-600 bg-[#0a0a0d] p-3.5 space-y-3 col-span-full shadow-lg font-sans"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                    <span className="text-xs font-sans font-bold uppercase text-white">
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
                    aria-label={lang === 'uk' ? 'Назва нотатки' : 'Note title'}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                    }}
                    style={{ color: editColor }}
                    className="w-full bg-[#060608] border border-neutral-800 text-base leading-[1.6] font-sans font-bold px-3 py-2 focus:outline-none focus:border-neutral-500"
                  />

                  <textarea
                    value={editContent}
                    aria-label={lang === 'uk' ? 'Текст нотатки' : 'Note text'}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                    }}
                    rows={4}
                    className="w-full bg-[#060608] border border-neutral-800 text-neutral-200 text-base leading-[1.6] font-sans p-2.5 focus:outline-none focus:border-neutral-500"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleToggleVoiceInput('content', note.id)}
                      className={`px-2.5 py-1 border text-xs font-sans uppercase flex items-center gap-1.5 cursor-pointer ${
                        isListening
                          ? 'border-red-500 bg-red-950/40 text-red-400'
                          : 'border-neutral-800 bg-[#060608] text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Mic className="w-3 h-3" />
                      <span>{isListening ? nv.voiceStop : nv.voiceDictation}</span>
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={handleDiscardEdit} className="min-h-11 px-2.5 py-1 border border-neutral-800 text-neutral-400 hover:text-rose-300 text-xs font-sans cursor-pointer">
                        {lang === 'uk' ? 'Видалити чернетку' : 'Discard draft'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePauseEdit}
                        className="min-h-11 px-2.5 py-1 border border-neutral-800 text-neutral-400 hover:text-white text-xs font-sans uppercase cursor-pointer"
                      >
                        {lang === 'uk' ? 'Закрити' : 'Close'}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={isVoiceStarting || isListening || isTranscribing || (!editTitle.trim() && !editContent.trim())}
                        className="min-h-11 px-3 py-1 bg-white text-black font-extrabold text-xs font-sans uppercase hover:bg-neutral-200 disabled:opacity-40 cursor-pointer"
                      >
                        {nv.updateNote}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <article
                key={note.id}
                className={`group relative flex min-w-0 flex-col border border-neutral-800 bg-[#09090d] p-4 sm:p-5 transition-colors hover:border-neutral-700 ${
                  viewMode === 'list' ? 'sm:flex-row sm:items-start sm:gap-6' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    {/* The note colour appears once, as a small swatch; the title stays readable white. */}
                    <h3 className="flex min-w-0 items-baseline gap-2.5 text-base font-semibold leading-snug text-neutral-100">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 -translate-y-px" style={{ backgroundColor: noteColor }} />
                      <span className="min-w-0 break-words line-clamp-2">{note.title}</span>
                    </h3>
                    {note.pinned && (
                      <Pin className="mt-1 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={lang === 'uk' ? 'Закріплено' : 'Pinned'} />
                    )}
                  </div>

                  <div className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">
                    {note.content || (
                      <span className="italic text-neutral-600">
                        {lang === 'uk' ? '(Порожній вміст)' : '(No content)'}
                      </span>
                    )}
                  </div>
                </div>

                <div className={`flex items-center justify-between gap-2 ${
                  viewMode === 'list' ? 'mt-4 sm:mt-0 sm:shrink-0 sm:flex-col sm:items-end' : 'mt-auto pt-4'
                }`}>
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-neutral-500">
                    {formatDate(note.createdAt)}{note.updatedAt ? ` · ${lang === 'uk' ? 'ред.' : 'edited'}` : ''}
                  </span>

                  {/* Tools appear on hover or keyboard focus where hover exists; touch screens always show them. */}
                  <div className="-mr-2 flex items-center transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        sound.tick(500);
                        onUpdateNote(note.id, { pinned: !note.pinned });
                      }}
                      title={note.pinned ? nv.unpinNote : nv.pinNote}
                      aria-label={note.pinned ? nv.unpinNote : nv.pinNote}
                      className={`${noteAction} ${note.pinned ? 'text-amber-400' : ''}`}
                    >
                      {note.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyNote(note)}
                      title={nv.copyNote}
                      aria-label={nv.copyNote}
                      className={noteAction}
                    >
                      {copiedId === note.id ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(note)}
                      title={nv.editNote}
                      aria-label={nv.editNote}
                      className={noteAction}
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(note)}
                      title={nv.deleteNote}
                      aria-label={nv.deleteNote}
                      className={`${noteAction} hover:text-rose-400`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-note-title"
        aria-describedby="delete-note-description"
        onCancel={() => setPendingDelete(null)}
        onClose={() => setPendingDelete(null)}
        onClick={(event) => { if (event.target === event.currentTarget) setPendingDelete(null); }}
        className="fixed m-auto w-[calc(100%-2rem)] max-w-md border border-neutral-700 bg-[#101014] p-0 text-neutral-100 shadow-2xl backdrop:bg-black/70"
      >
        <div className="space-y-4 p-5 font-sans">
          <h2 id="delete-note-title" className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
            {lang === 'uk' ? 'Видалити нотатку?' : 'Delete note?'}
          </h2>
          <p id="delete-note-description" className="text-xs leading-relaxed text-neutral-300">
            {lang === 'uk' ? 'Нотатку «' : 'The note “'}
            <span className="font-bold break-words">{pendingDelete?.title}</span>
            {lang === 'uk' ? '» буде видалено. Після видалення ви матимете 8 секунд, щоб відновити її кнопкою «Скасувати».' : '” will be deleted. You will have 8 seconds to restore it using Undo.'}
          </p>
          <div className="flex justify-end gap-2">
            <button autoFocus type="button" onClick={() => setPendingDelete(null)} className="border border-neutral-600 px-3 py-2 text-xs hover:bg-neutral-800">
              {nv.cancel}
            </button>
            <button type="button" onClick={handleConfirmDelete} className="bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-500">
              {lang === 'uk' ? 'Видалити' : 'Delete'}
            </button>
          </div>
        </div>
      </dialog>

      {/* Undo Toast for deleted note */}
      <AnimatePresence>
        {recentlyDeletedNote && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20, transition: { duration: 0.15 } }}
            className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 border border-neutral-700 px-4 py-2.5 flex items-center gap-3 shadow-2xl text-xs font-sans"
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
