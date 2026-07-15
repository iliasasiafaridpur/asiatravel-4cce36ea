import { useEffect, useMemo, useState } from "react";
import { Globe, Plus, Trash2, FolderPlus, ExternalLink, ChevronRight, ChevronDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";

type Bookmark = { id: string; name: string; url: string };
type Folder = { id: string; name: string; bookmarks: Bookmark[] };

const STORAGE_KEY = "online-service-bookmarks:v1";

function loadFolders(): Folder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function saveFolders(folders: Folder[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
  } catch { /* ignore */ }
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeUrl(u: string) {
  const t = u.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function OnlineServiceHeaderButton() {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newFolderName, setNewFolderName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");

  useEffect(() => {
    if (open) setFolders(loadFolders());
  }, [open]);

  const persist = (next: Folder[]) => {
    setFolders(next);
    saveFolders(next);
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const next = [...folders, { id: newId(), name, bookmarks: [] }];
    persist(next);
    setNewFolderName("");
    toast.success("ফোল্ডার তৈরি হয়েছে");
  };

  const removeFolder = (id: string) => {
    if (!confirm("এই ফোল্ডারটি এবং এর সকল বুকমার্ক মুছে ফেলবেন?")) return;
    persist(folders.filter((f) => f.id !== id));
  };

  const renameFolder = (id: string) => {
    const name = editFolderName.trim();
    if (!name) return;
    persist(folders.map((f) => (f.id === id ? { ...f, name } : f)));
    setEditingFolder(null);
    setEditFolderName("");
  };

  const addBookmark = (folderId: string) => {
    const name = linkName.trim();
    const url = normalizeUrl(linkUrl);
    if (!name || !url) {
      toast.error("নাম ও URL দিন");
      return;
    }
    const next = folders.map((f) =>
      f.id === folderId
        ? { ...f, bookmarks: [...f.bookmarks, { id: newId(), name, url }] }
        : f,
    );
    persist(next);
    setLinkName("");
    setLinkUrl("");
    setAddingTo(null);
    toast.success("লিংক সেভ হয়েছে");
  };

  const removeBookmark = (folderId: string, bmId: string) => {
    const next = folders.map((f) =>
      f.id === folderId ? { ...f, bookmarks: f.bookmarks.filter((b) => b.id !== bmId) } : f,
    );
    persist(next);
  };

  const totalCount = useMemo(
    () => folders.reduce((s, f) => s + f.bookmarks.length, 0),
    [folders],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Online Service" title="Online Service">
          <Globe className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-sky-400" />
            Online Service
            <span className="text-xs text-muted-foreground font-normal">
              ({folders.length} ফোল্ডার · {totalCount} লিংক)
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Add folder */}
          <div className="flex gap-2">
            <Input
              placeholder="নতুন ফোল্ডারের নাম"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addFolder(); }}
            />
            <Button onClick={addFolder} size="sm">
              <FolderPlus className="h-4 w-4 mr-1" /> যোগ
            </Button>
          </div>

          {/* Folder list */}
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              এখনো কোনো ফোল্ডার নেই। উপরে থেকে নতুন ফোল্ডার তৈরি করুন।
            </p>
          ) : (
            <div className="space-y-2">
              {folders.map((f) => {
                const isOpen = expanded[f.id] ?? true;
                return (
                  <div key={f.id} className="border border-border rounded-md">
                    <div className="flex items-center gap-1 p-2 bg-muted/30">
                      <button
                        onClick={() => setExpanded((s) => ({ ...s, [f.id]: !isOpen }))}
                        className="p-0.5 hover:bg-muted rounded"
                        aria-label="Toggle"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {editingFolder === f.id ? (
                        <Input
                          className="h-7 flex-1"
                          value={editFolderName}
                          onChange={(e) => setEditFolderName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") renameFolder(f.id); }}
                          autoFocus
                        />
                      ) : (
                        <span className="flex-1 text-sm font-medium truncate">
                          {f.name} <span className="text-xs text-muted-foreground">({f.bookmarks.length})</span>
                        </span>
                      )}
                      {editingFolder === f.id ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => renameFolder(f.id)}>OK</Button>
                      ) : (
                        <button
                          onClick={() => { setEditingFolder(f.id); setEditFolderName(f.name); }}
                          className="p-1 hover:bg-muted rounded"
                          aria-label="Rename"
                          title="নাম পরিবর্তন"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                      <button
                        onClick={() => setAddingTo(addingTo === f.id ? null : f.id)}
                        className="p-1 hover:bg-muted rounded"
                        aria-label="Add link"
                        title="লিংক যোগ"
                      >
                        <Plus className="h-4 w-4 text-emerald-500" />
                      </button>
                      <button
                        onClick={() => removeFolder(f.id)}
                        className="p-1 hover:bg-muted rounded"
                        aria-label="Delete folder"
                        title="ফোল্ডার মুছুন"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="p-2 space-y-1">
                        {addingTo === f.id && (
                          <div className="p-2 border border-dashed border-border rounded-md space-y-2 mb-2">
                            <Input
                              placeholder="সাইটের নাম (যেমন BMET Portal)"
                              value={linkName}
                              onChange={(e) => setLinkName(e.target.value)}
                              className="h-8"
                            />
                            <Input
                              placeholder="https://example.com"
                              value={linkUrl}
                              onChange={(e) => setLinkUrl(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") addBookmark(f.id); }}
                              className="h-8"
                            />
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => { setAddingTo(null); setLinkName(""); setLinkUrl(""); }}>বাতিল</Button>
                              <Button size="sm" onClick={() => addBookmark(f.id)}>সেভ</Button>
                            </div>
                          </div>
                        )}
                        {f.bookmarks.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-1">এই ফোল্ডারে কোনো লিংক নেই।</p>
                        ) : (
                          f.bookmarks.map((b) => (
                            <div key={b.id} className="flex items-center gap-1 group hover:bg-muted/50 rounded px-1">
                              <a
                                href={b.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 flex items-center gap-2 text-sm py-1.5 truncate"
                                title={b.url}
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                                <span className="truncate">{b.name}</span>
                              </a>
                              <button
                                onClick={() => removeBookmark(f.id, b.id)}
                                className="p-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded"
                                aria-label="Delete link"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
