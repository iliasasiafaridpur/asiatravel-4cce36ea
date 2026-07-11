import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ChevronLeft, StickyNote, Search } from "lucide-react";

type Note = {
  id: string;
  title: string;
  body: string;
  updated: number;
};

const STORAGE_KEY = "notepad_notes_v1";

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Note[]) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* ignore */
  }
}

const NOTE_TINTS = [
  "bg-amber-100 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/25",
  "bg-sky-100 dark:bg-sky-500/15 border-sky-200 dark:border-sky-500/25",
  "bg-emerald-100 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/25",
  "bg-fuchsia-100 dark:bg-fuchsia-500/15 border-fuchsia-200 dark:border-fuchsia-500/25",
];

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotePad({ open, onOpenChange }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open) {
      setNotes(loadNotes());
      setActiveId(null);
      setQ("");
    }
  }, [open]);

  const persist = (next: Note[]) => {
    setNotes(next);
    saveNotes(next);
  };

  const active = notes.find((n) => n.id === activeId) ?? null;

  const createNote = () => {
    const n: Note = { id: crypto.randomUUID(), title: "", body: "", updated: Date.now() };
    persist([n, ...notes]);
    setActiveId(n.id);
  };

  const updateActive = (patch: Partial<Note>) => {
    if (!active) return;
    persist(
      notes.map((n) => (n.id === active.id ? { ...n, ...patch, updated: Date.now() } : n)),
    );
  };

  const deleteActive = () => {
    if (!active) return;
    persist(notes.filter((n) => n.id !== active.id));
    setActiveId(null);
  };

  const sorted = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated), [notes]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter(
      (n) => n.title.toLowerCase().includes(term) || n.body.toLowerCase().includes(term),
    );
  }, [sorted, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            {active ? (
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> নোট সমূহ
              </button>
            ) : (
              <>
                <StickyNote className="h-4 w-4 text-amber-500" /> নোট প্যাড
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {active ? (
          <div className="flex flex-col gap-2 px-4 pb-4">
            <Input
              autoFocus
              value={active.title}
              onChange={(e) => updateActive({ title: e.target.value })}
              placeholder="শিরোনাম"
              className="text-base font-semibold"
            />
            <Textarea
              value={active.body}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder="এখানে লিখুন…"
              className="min-h-[45vh] resize-none text-sm leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">সেভ হয়েছে · {fmtTime(active.updated)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={deleteActive}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" /> মুছুন
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 pb-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="নোট খুঁজুন…"
                  className="pl-8 h-9"
                />
              </div>
              <Button type="button" size="sm" onClick={createNote} className="shrink-0">
                <Plus className="mr-1 h-4 w-4" /> নতুন
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto border-t p-3">
              {filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {notes.length === 0 ? "কোনো নোট নেই — নতুন নোট তৈরি করুন।" : "কিছু পাওয়া যায়নি"}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((n, i) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setActiveId(n.id)}
                      className={`flex flex-col rounded-lg border p-3 text-left transition-transform hover:scale-[1.02] ${NOTE_TINTS[i % NOTE_TINTS.length]}`}
                    >
                      <span className="truncate text-sm font-semibold">{n.title || "শিরোনামহীন"}</span>
                      <span className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {n.body || "…"}
                      </span>
                      <span className="mt-2 text-[10px] text-muted-foreground/80">{fmtTime(n.updated)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
