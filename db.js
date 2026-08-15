import { supabase } from "./supabaseClient";

/* ---------- teachers ---------- */
export async function listTeachers() {
  const { data, error } = await supabase.from("teachers").select("*").order("created_at");
  if (error) throw error;
  return data.map(rowToTeacher);
}
export async function createTeacher(t) {
  const { data, error } = await supabase.from("teachers").insert({
    username: t.username, password: t.password, role: t.role, level: t.level || null, stream: t.stream || null,
  }).select().single();
  if (error) throw error;
  return rowToTeacher(data);
}
export async function deleteTeacher(id) {
  const { error } = await supabase.from("teachers").delete().eq("id", id);
  if (error) throw error;
}
function rowToTeacher(r) {
  return { id: r.id, username: r.username, password: r.password, role: r.role, level: r.level || "", stream: r.stream || "" };
}

/* ---------- students ---------- */
export async function listStudents() {
  const { data, error } = await supabase.from("students").select("*").order("name");
  if (error) throw error;
  return data.map(rowToStudent);
}
export async function createStudent(s) {
  const { data, error } = await supabase.from("students").insert({
    name: s.name, level: s.level, stream: s.stream || "", guardian_contact: s.guardianContact || "", notes: s.notes || "",
  }).select().single();
  if (error) throw error;
  return rowToStudent(data);
}
export async function updateStudent(id, patch) {
  const { data, error } = await supabase.from("students").update({
    name: patch.name, level: patch.level, stream: patch.stream || "",
    guardian_contact: patch.guardianContact || "", notes: patch.notes || "",
  }).eq("id", id).select().single();
  if (error) throw error;
  return rowToStudent(data);
}
export async function deleteStudent(id) {
  const { error } = await supabase.from("students").delete().eq("id", id);
  if (error) throw error;
}
function rowToStudent(r) {
  return { id: r.id, name: r.name, level: r.level, stream: r.stream || "", guardianContact: r.guardian_contact || "", notes: r.notes || "" };
}

/* ---------- attendance ---------- */
export async function listAttendance() {
  const { data, error } = await supabase.from("attendance").select("*");
  if (error) throw error;
  return data.map((r) => ({ id: r.id, studentId: r.student_id, date: r.date, status: r.status, recordedBy: r.recorded_by }));
}
// status === null deletes the record for that student/date instead of writing one.
export async function upsertAttendance(studentId, date, status, recordedBy) {
  if (!status) {
    const { error } = await supabase.from("attendance").delete().eq("student_id", studentId).eq("date", date);
    if (error) throw error;
    return null;
  }
  const { data, error } = await supabase.from("attendance")
    .upsert({ student_id: studentId, date, status, recorded_by: recordedBy }, { onConflict: "student_id,date" })
    .select().single();
  if (error) throw error;
  return { id: data.id, studentId: data.student_id, date: data.date, status: data.status, recordedBy: data.recorded_by };
}

/* ---------- grades ---------- */
export async function listGrades() {
  const { data, error } = await supabase.from("grades").select("*").order("date");
  if (error) throw error;
  return data.map((r) => ({ id: r.id, studentId: r.student_id, subject: r.subject, score: r.score, maxScore: r.max_score, date: r.date, recordedBy: r.recorded_by }));
}
export async function createGrade(g) {
  const { data, error } = await supabase.from("grades").insert({
    student_id: g.studentId, subject: g.subject, score: g.score, max_score: g.maxScore, date: g.date, recorded_by: g.recordedBy,
  }).select().single();
  if (error) throw error;
  return { id: data.id, studentId: data.student_id, subject: data.subject, score: data.score, maxScore: data.max_score, date: data.date, recordedBy: data.recorded_by };
}
export async function deleteGrade(id) {
  const { error } = await supabase.from("grades").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- settings (school name) ---------- */
export async function getSchoolName() {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "schoolName").maybeSingle();
  if (error) throw error;
  return data ? data.value : "";
}
export async function setSchoolName(name) {
  const { error } = await supabase.from("settings").upsert({ key: "schoolName", value: name });
  if (error) throw error;
}
