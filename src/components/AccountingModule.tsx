// Accounting Module — standalone, localStorage-backed.
// এই module কে যেকোনো React app-এ import করে ব্যবহার করা যাবে।
// Supabase schema (suggested):
//   table accounting_users(id uuid pk, name text, phone text, current_balance numeric default 0)
//   table accounting_transactions(id uuid pk, user_id uuid null references accounting_users(id),
//       type text check (type in ('received','expense','handover')),
//       amount numeric, category text, description text, created_at timestamptz default now())

import { DateInput } from "@/components/ui/date-input";
import { PageWatermark } from "@/components/PageWatermark";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Download,
  Plus,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

// ===== Types =====
export interface AcctUser {
  id: string;
  name: string;
  phone: string;
  currentBalance: number;
}
export type TxType = "received" | "expense" | "handover";
export interface Transaction {
  id: string;
  userId: string | null;
  type: TxType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  description: string;
}

const INCOME_CATEGORIES = ["Ticket Sale", "Package Sale", "Visa Service", "Hotel Booking"];
const EXPENSE_CATEGORIES = ["Marketing", "Salary", "Rent", "Office Supplies", "Others"];

const LS_USERS = "acct_module_users_v1";
const LS_TX = "acct_module_tx_v1";
const today = () => new Date().toISOString().slice(0, 10);
const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fmt = (n: number) => `৳ ${Number(n || 0).toLocaleString()}`;

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export default function AccountingModule() {
  const [users, setUsers] = useState<AcctUser[]>(() => loadLS(LS_USERS, [] as AcctUser[]));
  const [txs, setTxs] = useState<Transaction[]>(() => loadLS(LS_TX, [] as Transaction[]));

  useEffect(() => saveLS(LS_USERS, users), [users]);
  useEffect(() => saveLS(LS_TX, txs), [txs]);

  // ===== Derived totals (top cards) =====
  const totals = useMemo(() => {
    let received = 0,
      expense = 0,
      handover = 0,
      handoverToday = 0;
    const t = today();
    for (const x of txs) {
      if (x.type === "received") received += x.amount;
      else if (x.type === "expense") expense += x.amount;
      else if (x.type === "handover") {
        handover += x.amount;
        if (x.date === t) handoverToday += x.amount;
      }
    }
    const cashInHand = received - expense - handover;
    const totalReceivable = users.reduce(
      (s, u) => s + (u.currentBalance > 0 ? u.currentBalance : 0),
      0,
    );
    return { cashInHand, totalReceivable, handoverToday, received, expense, handover };
  }, [txs, users]);

  // ===== Mutators =====
  const addUser = (name: string, phone: string) => {
    if (!name.trim()) return toast.error("নাম দিন");
    const u: AcctUser = { id: uid(), name: name.trim(), phone: phone.trim(), currentBalance: 0 };
    setUsers((prev) => [u, ...prev]);
    toast.success("✓ User added");
  };

  const adjustUserBalance = (userId: string, delta: number) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, currentBalance: u.currentBalance + delta } : u)),
    );
  };

  const recordReceived = (
    userId: string,
    amount: number,
    category: string,
    description: string,
    date: string,
  ) => {
    if (!userId) return toast.error("User select করুন");
    if (!(amount > 0)) return toast.error("Amount দিন");
    const tx: Transaction = {
      id: uid(),
      userId,
      type: "received",
      amount,
      category,
      date,
      description,
    };
    setTxs((p) => [tx, ...p]);
    adjustUserBalance(userId, amount); // balance বাড়বে (receivable side)
    toast.success("✓ Received entry হয়েছে");
  };

  const recordExpense = (amount: number, category: string, description: string, date: string) => {
    if (!(amount > 0)) return toast.error("Amount দিন");
    const tx: Transaction = {
      id: uid(),
      userId: null,
      type: "expense",
      amount,
      category,
      date,
      description,
    };
    setTxs((p) => [tx, ...p]);
    toast.success("✓ Expense entry হয়েছে");
  };

  const recordHandover = (userId: string, amount: number, description: string, date: string) => {
    if (!userId) return toast.error("User select করুন");
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    if (!(amount > 0)) return toast.error("Amount দিন");
    if (amount > u.currentBalance)
      return toast.error(`Handover (${fmt(amount)}) > Balance (${fmt(u.currentBalance)})`);
    const tx: Transaction = {
      id: uid(),
      userId,
      type: "handover",
      amount,
      category: "Hand Over",
      date,
      description,
    };
    setTxs((p) => [tx, ...p]);
    adjustUserBalance(userId, -amount);
    toast.success("✓ Hand-over entry হয়েছে");
  };

  return (
    <div className="relative z-10 space-y-4 max-w-6xl mx-auto p-2 sm:p-4">
      <PageWatermark text="ACCOUNTS" />
      <header className="rounded-xl border bg-card p-4 shadow-sm">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6" /> Accounting Module
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Travel Agency — User-wise income, expense, hand-over & ledger
        </p>
      </header>

      {/* ===== Top summary cards ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="Cash in Hand"
          value={totals.cashInHand}
          icon={<Wallet className="h-4 w-4" />}
          highlight
        />
        <SummaryCard
          label="Total Receivable"
          value={totals.totalReceivable}
          icon={<ArrowDownLeft className="h-4 w-4" />}
        />
        <SummaryCard
          label="Today's Handover"
          value={totals.handoverToday}
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <SummaryCard
          label="Total Expense"
          value={totals.expense}
          icon={<Receipt className="h-4 w-4" />}
        />
      </div>

      <Tabs defaultValue="receive" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="receive">User Receive</TabsTrigger>
          <TabsTrigger value="expense">Expense</TabsTrigger>
          <TabsTrigger value="handover">Hand-over</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
        </TabsList>

        <TabsContent value="receive">
          <ReceiveTab users={users} onAddUser={addUser} onSubmit={recordReceived} />
        </TabsContent>
        <TabsContent value="expense">
          <ExpenseTab onSubmit={recordExpense} />
        </TabsContent>
        <TabsContent value="handover">
          <HandoverTab users={users} onSubmit={recordHandover} />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab users={users} txs={txs} />
        </TabsContent>
        <TabsContent value="balances">
          <BalancesTab users={users} txs={txs} onAddUser={addUser} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===== Summary card =====
const summaryTint: Record<string, { bg: string; ring: string }> = {
  "Cash in Hand": { bg: "#064e3b", ring: "#10b981" }, // emerald
  "Total Receivable": { bg: "#7f1d1d", ring: "#f59e0b" }, // crimson/amber for due
  "Today's Handover": { bg: "#1e3a8a", ring: "#3b82f6" }, // royal navy
  "Total Expense": { bg: "#78350f", ring: "#f59e0b" }, // amber
};
function SummaryCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  const tint = summaryTint[label];
  const style = tint
    ? {
        background: tint.bg,
        boxShadow: `0 4px 22px -10px ${tint.ring}88, inset 0 0 0 1px ${tint.ring}55`,
      }
    : undefined;
  return (
    <Card className={highlight ? "border-primary/40 text-white" : "text-white"} style={style}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs opacity-90">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-1 text-xl font-bold">{fmt(value)}</div>
      </CardContent>
    </Card>
  );
}

// ===== Add User dialog (reused) =====
function AddUserDialog({ onAdd }: { onAdd: (name: string, phone: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" /> New User
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Button
            onClick={() => {
              onAdd(name, phone);
              setName("");
              setPhone("");
              setOpen(false);
            }}
            className="w-full"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===== Tab 1: Receive =====
function ReceiveTab({
  users,
  onAddUser,
  onSubmit,
}: {
  users: AcctUser[];
  onAddUser: (n: string, p: string) => void;
  onSubmit: (
    userId: string,
    amount: number,
    category: string,
    description: string,
    date: string,
  ) => void;
}) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base">User Receive (Income Entry)</CardTitle>
        <AddUserDialog onAdd={onAddUser} />
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  কোনো user নেই — উপরে New User দিন
                </div>
              ) : (
                users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} {u.phone ? `(${u.phone})` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCOME_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Amount</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div>
          <Label>Date</Label>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={() => {
              onSubmit(userId, amount, category, description, date);
              setAmount(0);
              setDescription("");
            }}
            className="w-full"
          >
            Save Received
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Tab 2: Expense =====
function ExpenseTab({
  onSubmit,
}: {
  onSubmit: (amount: number, category: string, description: string, date: string) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Expense Entry (Others Khata)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Amount</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div>
          <Label>Date</Label>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={() => {
              onSubmit(amount, category, description, date);
              setAmount(0);
              setDescription("");
            }}
            className="w-full"
          >
            Save Expense
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Tab 3: Handover =====
function HandoverTab({
  users,
  onSubmit,
}: {
  users: AcctUser[];
  onSubmit: (userId: string, amount: number, description: string, date: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  const selected = users.find((u) => u.id === userId);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Cash Hand-over (To Authority/Agent)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} — {fmt(u.currentBalance)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Current Balance</Label>
          <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 font-semibold">
            {selected ? fmt(selected.currentBalance) : "—"}
          </div>
        </div>
        <div>
          <Label>Handover Amount</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div>
          <Label>Date</Label>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={() => {
              onSubmit(userId, amount, description, date);
              setAmount(0);
              setDescription("");
            }}
            className="w-full"
          >
            Save Hand-over
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Tab 4: Ledger =====
function LedgerTab({ users, txs }: { users: AcctUser[]; txs: Transaction[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const filtered = useMemo(() => {
    return txs.filter((t) => {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (userFilter !== "all" && t.userId !== userFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return true;
    });
  }, [txs, from, to, userFilter, typeFilter]);

  // Running cash balance (oldest → newest)
  const withRunning = useMemo(() => {
    const ordered = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const mapped = ordered.map((t) => {
      if (t.type === "received") bal += t.amount;
      else bal -= t.amount; // expense + handover
      return { ...t, running: bal };
    });
    return mapped.reverse(); // newest on top
  }, [filtered]);

  const exportCsv = () => {
    const header = ["Date", "User", "Type", "Category", "Amount", "Running Cash", "Description"];
    const rows = withRunning.map((t) => [
      t.date,
      t.userId ? (userMap.get(t.userId) ?? "") : "—",
      t.type,
      t.category,
      t.amount,
      t.running,
      t.description.replaceAll("\n", " "),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Accounts_Ledger_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Ledger & Tracking ({filtered.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div>
            <Label>From</Label>
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>User</Label>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="handover">Hand-over</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={exportCsv} className="w-full gap-1.5">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Running Cash</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withRunning.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                    কোনো transaction নেই
                  </TableCell>
                </TableRow>
              ) : (
                withRunning.map((t, idx) => (
                  <TableRow key={t.id} className={`row-tint-${idx % 4}`}>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>{t.userId ? (userMap.get(t.userId) ?? "—") : "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.type === "received"
                            ? "default"
                            : t.type === "expense"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {t.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{t.category}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${t.type === "received" ? "text-green-600" : "text-red-600"}`}
                    >
                      {t.type === "received" ? "+" : "-"}
                      {fmt(t.amount)}
                    </TableCell>
                    <TableCell className="text-right">{fmt(t.running)}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{t.description}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Tab 5: Balances =====
function BalancesTab({
  users,
  txs,
  onAddUser,
}: {
  users: AcctUser[];
  txs: Transaction[];
  onAddUser: (n: string, p: string) => void;
}) {
  const [openUser, setOpenUser] = useState<AcctUser | null>(null);
  const userTxs = useMemo(
    () => (openUser ? txs.filter((t) => t.userId === openUser.id) : []),
    [openUser, txs],
  );
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <UsersIcon className="h-4 w-4" /> All Users Balance
        </CardTitle>
        <AddUserDialog onAdd={onAddUser} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Current Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                    কোনো user নেই
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u, idx) => (
                  <TableRow
                    key={u.id}
                    className={`cursor-pointer row-tint-${idx % 4}`}
                    onClick={() => setOpenUser(u)}
                  >
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell>{u.phone || "—"}</TableCell>
                    <TableCell
                      className={`text-right font-semibold ${u.currentBalance > 0 ? "text-green-600" : u.currentBalance < 0 ? "text-red-600" : ""}`}
                    >
                      {fmt(u.currentBalance)}
                    </TableCell>
                    <TableCell>
                      {u.currentBalance > 0 ? (
                        <Badge>Receivable</Badge>
                      ) : u.currentBalance < 0 ? (
                        <Badge variant="destructive">Payable</Badge>
                      ) : (
                        <Badge variant="secondary">Settled</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!openUser} onOpenChange={(o) => !o && setOpenUser(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{openUser?.name} — Transaction History</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userTxs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      No transactions
                    </TableCell>
                  </TableRow>
                ) : (
                  userTxs.map((t, idx) => (
                    <TableRow key={t.id} className={`row-tint-${idx % 4}`}>
                      <TableCell>{t.date}</TableCell>
                      <TableCell>
                        <Badge variant={t.type === "received" ? "default" : "secondary"}>
                          {t.type}
                        </Badge>
                      </TableCell>
                      <TableCell>{t.category}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${t.type === "received" ? "text-green-600" : "text-red-600"}`}
                      >
                        {t.type === "received" ? "+" : "-"}
                        {fmt(t.amount)}
                      </TableCell>
                      <TableCell>{t.description}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
