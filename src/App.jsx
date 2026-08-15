import React, { useState, useEffect, useMemo, useCallback } from "react";
import * as db from "./db";

/* ---------- constants ---------- */
const LEVELS = ["Senior 1", "Senior 2", "Senior 3", "Senior 4", "Senior 5", "Senior 6"];
const levelAbbrev = (level) => "S" + (level ? level.split(" ")[1] : "?");
const classLabel = (s) => (s.stream ? `${s.level} ${s.stream}` : s.level);
const classCode = (s) => `${levelAbbrev(s.level)}${s.stream ? s.stream : ""}`;
const STATUS_META = {
  present: { label: "Present", short: "P", color: "#16A34A", bg: "#DCFCE7" },
  late: { label: "Late", short: "L", color: "#B45309", bg: "#FEF3C7" },
  absent: { label: "Absent", short: "A", color: "#DC2626", bg: "#FEE2E2" },
  excused: { label: "Excused", short: "E", color: "#7C3AED", bg: "#EDE9FE" },
};

/* ---------- session (kept in the browser's localStorage, not Supabase) ---------- */
function loadSession() {
  try {
    const raw = localStorage.getItem("school_register_session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveSession(sess) {
  try {
    if (sess) localStorage.setItem("school_register_session", JSON.stringify(sess));
    else localStorage.removeItem("school_register_session");
  } catch (e) {
    console.error("session save failed", e);
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

/* ---------- risk engine ---------- */
function computeRisk(student, attendance, grades) {
  const att = attendance.filter((a) => a.studentId === student.id).sort((a, b) => a.date.localeCompare(b.date));
  const gr = grades.filter((g) => g.studentId === student.id).sort((a, b) => a.date.localeCompare(b.date));

  const countable = att.filter((a) => a.status !== "excused");
  const totalDays = countable.length;
  const presentDays = att.filter((a) => a.status === "present").length;
  const lateDays = att.filter((a) => a.status === "late").length;
  const attendanceRate = totalDays > 0 ? ((presentDays + lateDays) / totalDays) * 100 : null;
  const lateRate = totalDays > 0 ? (lateDays / totalDays) * 100 : 0;

  let streak = 0;
  for (let i = att.length - 1; i >= 0; i--) {
    if (att[i].status === "absent") streak++;
    else break;
  }

  const pct = (g) => (g.score / g.maxScore) * 100;
  let trendDelta = null;
  if (gr.length >= 2) {
    const recent = gr.slice(-Math.min(3, gr.length));
    const priorPool = gr.slice(0, gr.length - recent.length);
    const prior = priorPool.slice(-Math.min(3, priorPool.length));
    const avg = (arr) => arr.reduce((s, g) => s + pct(g), 0) / arr.length;
    if (recent.length && prior.length) trendDelta = avg(recent) - avg(prior);
  }
  const currentAvg = gr.length ? gr.slice(-3).reduce((s, g) => s + pct(g), 0) / Math.min(3, gr.length) : null;

  let score = 0;
  const factors = [];
  if (attendanceRate !== null) {
    if (attendanceRate < 60) { score += 40; factors.push(`Attendance rate is ${attendanceRate.toFixed(0)}% (below 60%)`); }
    else if (attendanceRate < 75) { score += 25; factors.push(`Attendance rate is ${attendanceRate.toFixed(0)}% (below 75%)`); }
    else if (attendanceRate < 90) { score += 12; factors.push(`Attendance rate is ${attendanceRate.toFixed(0)}% (below 90%)`); }
  }
  if (streak >= 5) { score += 25; factors.push(`Currently on a ${streak}-day unexplained absence streak`); }
  else if (streak >= 3) { score += 15; factors.push(`Currently on a ${streak}-day unexplained absence streak`); }
  if (lateRate > 30) { score += 12; factors.push(`Late ${lateRate.toFixed(0)}% of recorded days`); }
  else if (lateRate > 15) { score += 6; factors.push(`Late ${lateRate.toFixed(0)}% of recorded days`); }
  if (trendDelta !== null) {
    if (trendDelta <= -15) { score += 25; factors.push(`Recent scores dropped ${Math.abs(trendDelta).toFixed(0)} points vs prior work`); }
    else if (trendDelta <= -7) { score += 12; factors.push(`Recent scores down ${Math.abs(trendDelta).toFixed(0)} points vs prior work`); }
  }
  if (currentAvg !== null && currentAvg < 50) { score += 10; factors.push(`Current average is ${currentAvg.toFixed(0)}%`); }

  score = Math.min(100, score);
  let level = "low";
  if (score >= 45) level = "high";
  else if (score >= 20) level = "medium";

  return { score, level, factors, attendanceRate, lateRate, streak, trendDelta, currentAvg, totalDays };
}

const LEVEL_META = {
  low: { label: "Low risk", stamp: "CLEAR", color: "#16A34A", bg: "#DCFCE7" },
  medium: { label: "Needs attention", stamp: "WATCH", color: "#B45309", bg: "#FEF3C7" },
  high: { label: "High risk", stamp: "URGENT", color: "#DC2626", bg: "#FEE2E2" },
};

/* ---------- reusable bits ---------- */
function Stamp({ level, size = "md" }) {
  const meta = LEVEL_META[level];
  const dims = size === "sm" ? { fs: 10.5, pad: "3px 9px" } : { fs: 11.5, pad: "5px 12px" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "'Inter', sans-serif", fontWeight: 700,
      letterSpacing: "0.03em", color: meta.color, borderRadius: 20,
      padding: dims.pad, fontSize: dims.fs, background: meta.bg, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
      {meta.stamp}
    </span>
  );
}
function Card({ children, style }) {
  return <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 1px 3px rgba(15,23,42,0.06)", ...style }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, minWidth: 0 }}>
      <span style={{ color: "#64748B", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.03em", fontSize: 11, textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = { border: "1px solid #CBD5E1", borderRadius: 6, padding: "10px 10px", fontSize: 16, fontFamily: "'Inter', sans-serif", background: "#fff", color: "#1A202C", outline: "none", width: "100%", boxSizing: "border-box" };

function Btn({ children, onClick, variant = "primary", type = "button", style, disabled }) {
  const base = { fontFamily: "'Inter', sans-serif", fontSize: 13.5, letterSpacing: "0.01em", fontWeight: 600, padding: "11px 16px", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", border: "1.5px solid #1E3A5F", opacity: disabled ? 0.45 : 1, transition: "filter 0.12s ease" };
  const variants = {
    primary: { background: "#1E3A5F", color: "#FFFFFF", border: "1.5px solid #1E3A5F", boxShadow: "0 1px 2px rgba(30,58,95,0.25)" },
    ghost: { background: "transparent", color: "#1E3A5F", border: "1.5px solid #CBD5E1" },
    danger: { background: "#FEE2E2", color: "#DC2626", border: "1.5px solid #FCA5A5" },
  };
  return <button type={type} onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}

function LevelTabs({ value, onChange, includeAll = true, counts, allowed }) {
  let options = includeAll ? ["All", ...LEVELS] : LEVELS;
  if (allowed) options = options.filter((o) => o === "All" || allowed.includes(o));
  return (
    <div style={{ display: "flex", gap: 2, overflowX: "auto", marginBottom: 16, borderBottom: "1px solid #E2E8F0", WebkitOverflowScrolling: "touch" }}>
      {options.map((lv) => {
        const active = value === lv;
        return (
          <div key={lv} onClick={() => onChange(lv)} style={{
            padding: "9px 13px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, flexShrink: 0,
            color: active ? "#1E3A5F" : "#64748B", fontWeight: active ? 700 : 500,
            borderBottom: active ? "2.5px solid #2563EB" : "2.5px solid transparent", marginBottom: -1,
          }}>
            {lv === "All" ? "All classes" : levelAbbrev(lv)}
            {counts && counts[lv] !== undefined ? <span style={{ color: "#94A3B8", marginLeft: 5 }}>({counts[lv]})</span> : null}
          </div>
        );
      })}
    </div>
  );
}

const pageStyle = { background: "#F4F6F9", minHeight: "100vh", color: "#1A202C", fontFamily: "'Inter', sans-serif" };
const fontImports = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
* { box-sizing: border-box; }
body { margin: 0; }
::placeholder { color: #94A3B8; }
input:focus, select:focus { border-color: #2563EB !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
table { border-collapse: collapse; width: 100%; }
`;

/* ================= AUTH GATE ================= */
export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | setup | login | app
  const [accounts, setAccounts] = useState([]);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const accts = await db.listTeachers();
        const sess = loadSession();
        setAccounts(accts);
        if (accts.length === 0) {
          setPhase("setup");
        } else if (sess && accts.some((a) => a.username === sess.username)) {
          setSession(sess);
          setPhase("app");
        } else {
          setPhase("login");
        }
      } catch (err) {
        console.error("failed to load teacher accounts", err);
        setError("Couldn't reach the database. Check your Supabase URL/key and that the schema has been run.");
        setPhase("login");
      }
    })();
  }, []);

  const doLogin = async (username, password) => {
    try {
      const fresh = await db.listTeachers();
      setAccounts(fresh);
      const acct = fresh.find((a) => a.username.toLowerCase() === username.trim().toLowerCase() && a.password === password);
      if (!acct) { setError("Incorrect username or password."); return; }
      const sess = { username: acct.username };
      saveSession(sess);
      setSession(sess);
      setError("");
      setPhase("app");
    } catch (err) {
      console.error("login failed", err);
      setError("Couldn't reach the database. Please try again.");
    }
  };

  const doSetup = async (adminUser) => {
    const created = await db.createTeacher(adminUser);
    setAccounts([created]);
    const sess = { username: created.username };
    saveSession(sess);
    setSession(sess);
    setPhase("app");
  };

  const doLogout = async () => {
    saveSession(null);
    setSession(null);
    setPhase("login");
  };

  if (phase === "loading") {
    return <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{fontImports}</style>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#64748B" }}>Loading register…</span>
    </div>;
  }
  if (phase === "setup") return <SetupScreen onCreate={doSetup} />;
  if (phase === "login") return <LoginScreen onLogin={doLogin} error={error} />;

  const currentUser = accounts.find((a) => a.username === session.username);
  if (!currentUser) return <LoginScreen onLogin={doLogin} error={error} />;

  return <MainApp currentUser={currentUser} accounts={accounts} setAccounts={setAccounts} onLogout={doLogout} />;
}

/* ---------- setup / login screens ---------- */
function AuthShell({ children, title, subtitle }) {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{fontImports}</style>
      <Card style={{ padding: "28px 24px", width: "100%", maxWidth: 380 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 22, color: "#1E3A5F", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 20 }}>{subtitle}</div>
        {children}
      </Card>
    </div>
  );
}

function SetupScreen({ onCreate }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const isValid = username.trim().length > 0 && password.length >= 4;

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setFormError("");
    if (!username.trim()) { setFormError("Enter a username."); return; }
    if (password.length < 4) { setFormError("Password must be at least 4 characters."); return; }
    setBusy(true);
    try {
      if (schoolName.trim()) await db.setSchoolName(schoolName.trim());
      await onCreate({ username: username.trim(), password, role: "admin" });
    } catch (err) {
      console.error("setup failed", err);
      setFormError("Setup failed: " + (err && err.message ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Set up the register" subtitle="No accounts exist yet. Create the first administrator account to get started.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="School name (optional)"><input style={inputStyle} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Greenhill Secondary School" /></Field>
        <Field label="Admin username"><input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" /></Field>
        <Field label="Admin password"><input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div style={{ fontSize: 11.5, color: "#94A3B8" }}>Minimum 4 characters. Stored in your Supabase project — not encrypted, so don't reuse a sensitive password here.</div>
        {formError && <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{formError}</div>}
        <Btn type="submit" onClick={submit} disabled={busy} style={{
          marginTop: 4,
          background: isValid ? "#2563EB" : "#1E3A5F",
          border: `1.5px solid ${isValid ? "#2563EB" : "#1E3A5F"}`,
        }}>{busy ? "Creating…" : isValid ? "Create admin account →" : "Create admin account"}</Btn>
      </form>
    </AuthShell>
  );
}

function LoginScreen({ onLogin, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setLocalError("");
    if (!username.trim() || !password) { setLocalError("Enter both a username and password."); return; }
    setBusy(true);
    await onLogin(username, password);
    setBusy(false);
  };
  return (
    <AuthShell title="Sign in" subtitle="Enter your credentials to open your class register.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Username"><input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" /></Field>
        <Field label="Password"><input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {(localError || error) && <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{localError || error}</div>}
        <Btn type="submit" onClick={submit} disabled={busy} style={{ marginTop: 4 }}>{busy ? "Signing in…" : "Sign in"}</Btn>
      </form>
    </AuthShell>
  );
}

/* ================= MAIN APP (post-login) ================= */
function MainApp({ currentUser, accounts, setAccounts, onLogout }) {
  const isAdmin = currentUser.role === "admin";
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [grades, setGrades] = useState([]);
  const [schoolName, setSchoolName] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a, g, sn] = await Promise.all([
        db.listStudents(), db.listAttendance(), db.listGrades(), db.getSchoolName(),
      ]);
      setStudents(s); setAttendance(a); setGrades(g); setSchoolName(sn);
    } catch (err) {
      console.error("failed to load data", err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const addStudent = async (s) => { const created = await db.createStudent(s); setStudents((prev) => [...prev, created]); notify("Student registered."); };
  const updateStudentRecord = async (upd) => { const saved = await db.updateStudent(upd.id, upd); setStudents((prev) => prev.map((s) => (s.id === saved.id ? saved : s))); notify("Student updated."); };
  const removeStudent = async (id) => {
    await db.deleteStudent(id); // attendance & grades cascade-delete in the database
    setStudents((prev) => prev.filter((s) => s.id !== id));
    setAttendance((prev) => prev.filter((a) => a.studentId !== id));
    setGrades((prev) => prev.filter((g) => g.studentId !== id));
    setSelectedStudent(null);
    notify("Student record removed.");
  };
  const addGrade = async (g) => { const created = await db.createGrade(g); setGrades((prev) => [...prev, created]); notify("Grade recorded."); };
  const removeGrade = async (id) => { await db.deleteGrade(id); setGrades((prev) => prev.filter((g) => g.id !== id)); notify("Grade removed."); };
  const persistSchoolName = async (name) => { setSchoolName(name); await db.setSchoolName(name); };
  const addTeacher = async (t) => { const created = await db.createTeacher(t); setAccounts((prev) => [...prev, created]); notify("Teacher account created."); };
  const removeTeacher = async (id) => { await db.deleteTeacher(id); setAccounts((prev) => prev.filter((a) => a.id !== id)); notify("Teacher account removed."); };

  const markAttendance = async (studentId, date, status) => {
    const saved = await db.upsertAttendance(studentId, date, status, currentUser.username);
    setAttendance((prev) => {
      const filtered = prev.filter((a) => !(a.studentId === studentId && a.date === date));
      return saved ? [...filtered, saved] : filtered;
    });
  };

  // scope: which levels/streams this user may see
  const allowedLevels = isAdmin ? LEVELS : [currentUser.level];
  const canSeeStudent = (s) => isAdmin || (s.level === currentUser.level && (!currentUser.stream || s.stream === currentUser.stream));
  const scopedStudents = students.filter(canSeeStudent);

  const risks = useMemo(() => {
    const map = {};
    students.forEach((s) => { map[s.id] = computeRisk(s, attendance, grades); });
    return map;
  }, [students, attendance, grades]);

  if (loading) {
    return <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{fontImports}</style>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#64748B" }}>Loading register…</span>
    </div>;
  }

  const navItems = [
    { id: "dashboard", label: "Overview" },
    { id: "students", label: "Students" },
    { id: "attendance", label: "Attendance" },
    ...(isAdmin ? [{ id: "teachers", label: "Staff" }] : []),
  ];

  return (
    <div style={pageStyle}>
      <style>{fontImports}</style>
      <TopHeader
        schoolName={schoolName} isAdmin={isAdmin} onEditSchoolName={persistSchoolName}
        currentUser={currentUser} onLogout={onLogout}
      />
      <div style={{ display: "flex", gap: 2, overflowX: "auto", padding: "0 16px", background: "#1E3A5F", WebkitOverflowScrolling: "touch" }}>
        {navItems.map((it) => (
          <div key={it.id} onClick={() => { setTab(it.id); setSelectedStudent(null); }} style={{
            padding: "12px 16px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, flexShrink: 0,
            color: tab === it.id ? "#FFFFFF" : "#93ACD3", fontWeight: tab === it.id ? 700 : 500,
            borderBottom: tab === it.id ? "3px solid #2563EB" : "3px solid transparent",
          }}>{it.label}</div>
        ))}
      </div>

      <div style={{ padding: "18px 16px 48px", maxWidth: 760, margin: "0 auto" }}>
        {!isAdmin && (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#475569", marginBottom: 14, background: "#EFF6FF", border: "1px solid #E2E8F0", borderRadius: 6, padding: "8px 12px" }}>
            Signed in to {currentUser.level}{currentUser.stream ? ` ${currentUser.stream}` : ""} only
          </div>
        )}

        {tab === "dashboard" && (
          <Dashboard students={scopedStudents} risks={risks} isAdmin={isAdmin}
            onOpen={(s) => { setSelectedStudent(s); setTab("students"); }} />
        )}

        {tab === "students" && !selectedStudent && (
          <StudentsView students={scopedStudents} risks={risks} allowedLevels={allowedLevels} lockedUser={isAdmin ? null : currentUser}
            onAdd={addStudent}
            onSelect={setSelectedStudent} />
        )}
        {tab === "students" && selectedStudent && canSeeStudent(selectedStudent) && (
          <StudentDetail
            student={students.find((s) => s.id === selectedStudent.id) || selectedStudent}
            attendance={attendance} grades={grades} risk={risks[selectedStudent.id]} teacherName={currentUser.username}
            isAdmin={isAdmin}
            onBack={() => setSelectedStudent(null)}
            onUpdate={updateStudentRecord}
            onDelete={removeStudent}
            onAddGrade={(g) => addGrade({ ...g, studentId: selectedStudent.id, recordedBy: currentUser.username })}
            onDeleteGrade={removeGrade}
          />
        )}

        {tab === "attendance" && (
          <AttendanceView students={scopedStudents} attendance={attendance} allowedLevels={allowedLevels}
            onMark={markAttendance} />
        )}

        {tab === "teachers" && isAdmin && (
          <TeachersView accounts={accounts} currentUser={currentUser}
            onAdd={addTeacher}
            onRemove={removeTeacher}
          />
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "#1E3A5F", color: "#FFFFFF", padding: "10px 18px", borderRadius: 4,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, boxShadow: "0 2px 8px rgba(0,0,0,0.25)", zIndex: 50,
        }}>{toast}</div>
      )}
    </div>
  );
}

/* ---------- top header ---------- */
function TopHeader({ schoolName, isAdmin, onEditSchoolName, currentUser, onLogout }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(schoolName);
  useEffect(() => { setDraft(schoolName); }, [schoolName]);

  return (
    <div style={{ background: "#1E3A5F", padding: "16px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input autoFocus style={{ ...inputStyle, fontSize: 15, padding: "6px 8px" }} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onEditSchoolName(draft.trim()); setEditing(false); } }} />
            <Btn style={{ padding: "6px 10px" }} onClick={() => { onEditSchoolName(draft.trim()); setEditing(false); }}>Save</Btn>
          </div>
        ) : (
          <div onClick={() => isAdmin && setEditing(true)} style={{
            fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 20, color: "#FFFFFF", cursor: isAdmin ? "pointer" : "default",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {schoolName || "Untitled School"}{isAdmin && <span style={{ fontSize: 11, color: "#93ACD3", marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" }}>edit</span>}
          </div>
        )}
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#93ACD3", marginTop: 3 }}>Student Register &amp; Risk Tracker</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#FFFFFF", fontWeight: 600 }}>{currentUser.username}</div>
        <div style={{ fontSize: 10.5, color: "#93ACD3", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{currentUser.role}</div>
        <span onClick={onLogout} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#2563EB", cursor: "pointer", textDecoration: "underline" }}>Sign out</span>
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */
function Dashboard({ students, risks, isAdmin, onOpen }) {
  const list = students.map((s) => ({ student: s, risk: risks[s.id] })).filter((r) => r.risk);
  const high = list.filter((r) => r.risk.level === "high").sort((a, b) => b.risk.score - a.risk.score);
  const medium = list.filter((r) => r.risk.level === "medium").sort((a, b) => b.risk.score - a.risk.score);
  const withAtt = list.filter((r) => r.risk.attendanceRate !== null);
  const avgAttendance = withAtt.length ? withAtt.reduce((s, r) => s + r.risk.attendanceRate, 0) / withAtt.length : null;

  const StatCard = ({ label, value, accent }) => (
    <Card style={{ padding: "14px 14px", flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 26, color: accent || "#1E3A5F" }}>{value}</div>
    </Card>
  );

  return (
    <div>
      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 19, color: "#1E3A5F", marginBottom: 14 }}>Overview</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
        <StatCard label="Students" value={students.length} />
        <StatCard label="High risk" value={high.length} accent="#DC2626" />
        <StatCard label="Watch list" value={medium.length} accent="#B45309" />
        <StatCard label="Avg attendance" value={avgAttendance !== null ? `${avgAttendance.toFixed(0)}%` : "—"} />
      </div>

      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "#64748B", fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Students needing attention
      </div>
      {high.length === 0 && medium.length === 0 && (
        <Card style={{ padding: 18, textAlign: "center", color: "#64748B", fontSize: 13 }}>
          No students currently flagged. Record attendance and grades to keep this list accurate.
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...high, ...medium].map(({ student, risk }) => (
          <Card key={student.id} onClick={() => onOpen(student)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{student.name}</div>
              <div style={{ fontSize: 11.5, color: "#64748B", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>{classLabel(student)}</div>
              {risk.factors[0] && <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{risk.factors[0]}</div>}
            </div>
            <Stamp level={risk.level} size="sm" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- students list + add ---------- */
function StudentsView({ students, risks, allowedLevels, lockedUser, onAdd, onSelect }) {
  const [levelTab, setLevelTab] = useState(lockedUser ? lockedUser.level : "All");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = students
    .filter((s) => levelTab === "All" || s.level === levelTab)
    .filter((s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 19, color: "#1E3A5F" }}>Students</div>
        <Btn onClick={() => setShowAdd((v) => !v)} style={{ padding: "8px 12px" }}>{showAdd ? "Cancel" : "+ Add student"}</Btn>
      </div>

      {showAdd && (
        <AddStudentForm allowedLevels={allowedLevels} lockedUser={lockedUser}
          onAdd={(s) => { onAdd(s); setShowAdd(false); }} />
      )}

      <LevelTabs value={levelTab} onChange={setLevelTab} allowed={allowedLevels} />
      <input style={{ ...inputStyle, marginBottom: 14 }} placeholder="Search by name…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {filtered.length === 0 && (
        <Card style={{ padding: 18, textAlign: "center", color: "#64748B", fontSize: 13 }}>No students found. Register a student to begin tracking them.</Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((s) => {
          const risk = risks[s.id];
          return (
            <Card key={s.id} onClick={() => onSelect(s)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: "#64748B", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>{classLabel(s)}</div>
              </div>
              {risk && <Stamp level={risk.level} size="sm" />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function AddStudentForm({ allowedLevels, lockedUser, onAdd }) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState(lockedUser ? lockedUser.level : (allowedLevels[0] || LEVELS[0]));
  const [stream, setStream] = useState(lockedUser && lockedUser.stream ? lockedUser.stream : "");
  const [guardian, setGuardian] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!name.trim()) { setErr("Enter the student's name."); return; }
    onAdd({ name: name.trim(), level, stream: stream.trim(), guardianContact: guardian.trim(), notes: "" });
  };

  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Full name"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 2 }}>
            <Field label="Class">
              <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)} disabled={!!lockedUser}>
                {(lockedUser ? [lockedUser.level] : allowedLevels.filter((l) => l !== "All")).map((lv) => <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Stream">
              <input style={inputStyle} placeholder="A" value={stream} onChange={(e) => setStream(e.target.value)} disabled={!!(lockedUser && lockedUser.stream)} />
            </Field>
          </div>
        </div>
        <Field label="Guardian contact (optional)"><input style={inputStyle} value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="Phone or email" /></Field>
        {err && <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{err}</div>}
        <Btn type="submit" onClick={submit}>Register student</Btn>
      </form>
    </Card>
  );
}

/* ---------- student detail ---------- */
function StudentDetail({ student, attendance, grades, risk, teacherName, isAdmin, onBack, onUpdate, onDelete, onAddGrade, onDeleteGrade }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(student);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showGradeForm, setShowGradeForm] = useState(false);
  useEffect(() => { setDraft(student); }, [student]);

  const studentAtt = attendance.filter((a) => a.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const studentGrades = grades.filter((g) => g.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date));

  const saveEdit = () => { onUpdate({ ...draft, name: draft.name.trim() }); setEditing(false); };

  return (
    <div>
      <div onClick={onBack} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#1E3A5F", cursor: "pointer", marginBottom: 14 }}>← Back to students</div>

      <Card style={{ padding: 18, marginBottom: 16 }}>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Full name"><input style={inputStyle} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            {isAdmin && (
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 2 }}><Field label="Class"><select style={inputStyle} value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>{LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}</select></Field></div>
                <div style={{ flex: 1 }}><Field label="Stream"><input style={inputStyle} value={draft.stream || ""} onChange={(e) => setDraft({ ...draft, stream: e.target.value })} /></Field></div>
              </div>
            )}
            <Field label="Guardian contact"><input style={inputStyle} value={draft.guardianContact || ""} onChange={(e) => setDraft({ ...draft, guardianContact: e.target.value })} /></Field>
            <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={saveEdit}>Save changes</Btn>
              <Btn variant="ghost" onClick={() => { setDraft(student); setEditing(false); }}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 21, color: "#1E3A5F" }}>{student.name}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#64748B", marginTop: 3 }}>{classLabel(student)} · {classCode(student)}</div>
                {student.guardianContact && <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 8 }}>Guardian: {student.guardianContact}</div>}
                {student.notes && <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 4 }}>{student.notes}</div>}
              </div>
              {risk && <Stamp level={risk.level} />}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn variant="ghost" style={{ padding: "8px 12px" }} onClick={() => setEditing(true)}>Edit</Btn>
              {isAdmin && (
                confirmDelete ? (
                  <>
                    <Btn variant="danger" style={{ padding: "8px 12px" }} onClick={() => onDelete(student.id)}>Confirm delete</Btn>
                    <Btn variant="ghost" style={{ padding: "8px 12px" }} onClick={() => setConfirmDelete(false)}>Keep record</Btn>
                  </>
                ) : (
                  <Btn variant="danger" style={{ padding: "8px 12px" }} onClick={() => setConfirmDelete(true)}>Remove student</Btn>
                )
              )}
            </div>
          </div>
        )}
      </Card>

      {risk && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 700, color: "#64748B", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>Risk assessment</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: risk.factors.length ? 12 : 0 }}>
            <MetricMini label="Attendance" value={risk.attendanceRate !== null ? `${risk.attendanceRate.toFixed(0)}%` : "—"} />
            <MetricMini label="Absence streak" value={`${risk.streak}d`} />
            <MetricMini label="Current avg" value={risk.currentAvg !== null ? `${risk.currentAvg.toFixed(0)}%` : "—"} />
            <MetricMini label="Score trend" value={risk.trendDelta !== null ? `${risk.trendDelta > 0 ? "+" : ""}${risk.trendDelta.toFixed(0)}` : "—"} />
          </div>
          {risk.factors.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#64748B", lineHeight: 1.7 }}>
              {risk.factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: 12.5, color: "#475569" }}>No risk factors detected from recorded data.</div>
          )}
        </Card>
      )}

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 700, color: "#64748B", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent attendance</div>
        {studentAtt.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#475569" }}>No attendance recorded yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {studentAtt.map((a) => {
              const m = STATUS_META[a.status];
              return <span key={a.id} title={`${fmtDate(a.date)} — ${m.label}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: m.color, background: m.bg, border: `1px solid ${m.color}`, borderRadius: 6, padding: "3px 7px" }}>{fmtDate(a.date)} {m.short}</span>;
            })}
          </div>
        )}
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Grades</div>
          <Btn variant="ghost" style={{ padding: "6px 10px" }} onClick={() => setShowGradeForm((v) => !v)}>{showGradeForm ? "Cancel" : "+ Add grade"}</Btn>
        </div>
        {showGradeForm && (
          <GradeForm onAdd={(g) => { onAddGrade(g); setShowGradeForm(false); }} />
        )}
        {studentGrades.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#475569" }}>No grades recorded yet.</div>
        ) : (
          <table>
            <tbody>
              {studentGrades.map((g) => (
                <tr key={g.id} style={{ borderBottom: "1px solid #EFF6FF" }}>
                  <td style={{ padding: "8px 4px", fontSize: 13 }}>{g.subject}</td>
                  <td style={{ padding: "8px 4px", fontSize: 12, color: "#64748B", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtDate(g.date)}</td>
                  <td style={{ padding: "8px 4px", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{g.score}/{g.maxScore}</td>
                  <td style={{ padding: "8px 4px", width: 24 }}>
                    <span onClick={() => onDeleteGrade(g.id)} style={{ cursor: "pointer", color: "#DC2626", fontSize: 14 }}>×</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function MetricMini({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#1E3A5F", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function GradeForm({ onAdd }) {
  const [subject, setSubject] = useState("");
  const [score, setScore] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState("");
  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const s = parseFloat(score), m = parseFloat(maxScore);
    if (!subject.trim()) { setErr("Enter a subject."); return; }
    if (isNaN(s) || isNaN(m) || m <= 0 || s < 0) { setErr("Enter a valid score."); return; }
    onAdd({ subject: subject.trim(), score: s, maxScore: m, date });
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, background: "#F8FAFC", padding: 12, borderRadius: 6, border: "1px solid #E2E8F0" }}>
      <Field label="Subject / assessment"><input style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Math CAT 2" /></Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Field label="Score"><input style={inputStyle} type="number" value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        <Field label="Out of"><input style={inputStyle} type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></Field>
      </div>
      <Field label="Date"><input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {err && <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{err}</div>}
      <Btn type="submit" onClick={submit}>Save grade</Btn>
    </form>
  );
}

/* ---------- attendance ---------- */
function AttendanceView({ students, attendance, allowedLevels, onMark }) {
  const [levelTab, setLevelTab] = useState(allowedLevels[0] || LEVELS[0]);
  const [date, setDate] = useState(todayISO());

  const scoped = students.filter((s) => levelTab === "All" || s.level === levelTab).sort((a, b) => a.name.localeCompare(b.name));
  const recordFor = (studentId) => attendance.find((a) => a.studentId === studentId && a.date === date);

  const markedCount = scoped.filter((s) => recordFor(s.id)).length;

  return (
    <div>
      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 19, color: "#1E3A5F", marginBottom: 14 }}>Attendance</div>
      <Card style={{ padding: 14, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Date"><input style={inputStyle} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#64748B" }}>{markedCount}/{scoped.length} marked</div>
      </Card>

      <LevelTabs value={levelTab} onChange={setLevelTab} includeAll={allowedLevels.length > 1} allowed={allowedLevels} />

      {scoped.length === 0 && (
        <Card style={{ padding: 18, textAlign: "center", color: "#64748B", fontSize: 13 }}>No students in this class yet.</Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scoped.map((s) => {
          const rec = recordFor(s.id);
          return (
            <Card key={s.id} style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#64748B", fontFamily: "'IBM Plex Mono', monospace" }}>{classCode(s)}</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {Object.entries(STATUS_META).map(([key, m]) => {
                  const active = rec && rec.status === key;
                  return (
                    <span key={key} onClick={() => onMark(s.id, date, active ? null : key)} title={m.label} style={{
                      cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, fontWeight: 700,
                      width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 6, border: `1.5px solid ${m.color}`, color: active ? "#FFFFFF" : m.color,
                      background: active ? m.color : "transparent",
                    }}>{m.short}</span>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- staff / admin panel ---------- */
function TeachersView({ accounts, currentUser, onAdd, onRemove }) {
  const [showAdd, setShowAdd] = useState(false);
  const [removeId, setRemoveId] = useState(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 19, color: "#1E3A5F" }}>Staff accounts</div>
        <Btn onClick={() => setShowAdd((v) => !v)} style={{ padding: "8px 12px" }}>{showAdd ? "Cancel" : "+ Add teacher"}</Btn>
      </div>

      {showAdd && <AddTeacherForm existing={accounts} onAdd={(a) => { onAdd(a); setShowAdd(false); }} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {accounts.map((a) => (
          <Card key={a.id} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.username}{a.id === currentUser.id && <span style={{ fontSize: 11, color: "#64748B", fontWeight: 500 }}> (you)</span>}</div>
              <div style={{ fontSize: 11.5, color: "#64748B", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                {a.role === "admin" ? "Administrator" : `Teacher · ${a.level}${a.stream ? " " + a.stream : ""}`}
              </div>
            </div>
            {a.role !== "admin" && (
              removeId === a.id ? (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Btn variant="danger" style={{ padding: "7px 10px" }} onClick={() => { onRemove(a.id); setRemoveId(null); }}>Confirm</Btn>
                  <Btn variant="ghost" style={{ padding: "7px 10px" }} onClick={() => setRemoveId(null)}>Cancel</Btn>
                </div>
              ) : (
                <Btn variant="danger" style={{ padding: "7px 10px", flexShrink: 0 }} onClick={() => setRemoveId(a.id)}>Remove</Btn>
              )
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function AddTeacherForm({ existing, onAdd }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState(LEVELS[0]);
  const [stream, setStream] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!username.trim()) { setErr("Enter a username."); return; }
    if (existing.some((a) => a.username.toLowerCase() === username.trim().toLowerCase())) { setErr("That username is already taken."); return; }
    if (password.length < 4) { setErr("Password must be at least 4 characters."); return; }
    onAdd({ username: username.trim(), password, role: "teacher", level, stream: stream.trim() });
  };

  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Username"><input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" /></Field>
        <Field label="Temporary password"><input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 2 }}><Field label="Assigned class"><select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}</select></Field></div>
          <div style={{ flex: 1 }}><Field label="Stream (optional)"><input style={inputStyle} placeholder="A" value={stream} onChange={(e) => setStream(e.target.value)} /></Field></div>
        </div>
        <div style={{ fontSize: 11.5, color: "#94A3B8" }}>Leave stream blank to give this teacher access to the whole class level.</div>
        {err && <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{err}</div>}
        <Btn type="submit" onClick={submit}>Create account</Btn>
      </form>
    </Card>
  );
}
