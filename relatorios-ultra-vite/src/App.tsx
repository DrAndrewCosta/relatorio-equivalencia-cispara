import React, { useEffect, useMemo, useRef, useState } from "react";

const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRDate = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("-") : "");

const BASE_KEYS = ["Abdominal total","Rins e Vias","Transvaginal"] as const;
type BaseKey = typeof BASE_KEYS[number];
type Prices = Record<BaseKey, number>;
type EqMap = Partial<Record<BaseKey, number>>;

type Clinic = { id: string; name: string; logo?: string; place?: string; city?: string; };
type CustomExam = { id: string; label: string; priceCents: number };
type ExamId = typeof EXAMS[number]["id"] | `custom:${string}`;
type Row = { id: string; clinicId: string; date: string; examId: ExamId; qty: number; obs?: string; };
type ChangeLine = { id: string; clinicId: string; date: string; patient: string; requested: string; performed: string; reason: string; };

const EXAMS = [
  { id: "obst_rot", label: "Obstétrico de rotina (pré-natal)", map: { "Abdominal total": 1 } as EqMap },
  { id: "morf_1tri", label: "Obstétrico morfológico (1º trimestre)", map: { "Abdominal total": 1, "Rins e Vias": 1 } },
  { id: "morf_2tri", label: "Morfológico do 2º trimestre", map: { "Abdominal total": 1, "Rins e Vias": 1, "Transvaginal": 1 } },
  { id: "mamas_axilas", label: "Mamas / Mamas e Axilas", map: { "Rins e Vias": 2 } },
] as const;
const EQ_IDS = new Set(["obst_rot","morf_1tri","morf_2tri","mamas_axilas"]);

const ALLOWED_DIRECT_EXAMS = [
  { label: "Ultrassonografia - rins e vias urinárias", price: 119.61 },
  { label: "Ultrassonografia - abdominal total", price: 134.38 },
  { label: "Ultrassonografia - transvaginal", price: 109.33 },
] as const;
const ALLOWED_LABELS_SET = new Set(ALLOWED_DIRECT_EXAMS.map((e) => e.label.toLowerCase()));
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState] as const;
}

const Card: React.FC<{ title: string; right?: React.ReactNode; children?: React.ReactNode }> = ({ title, right, children }) => (
  <div className="card border border-zinc-200 rounded-2xl shadow p-4 md:p-6 print:border print:shadow-none">
    <div className="flex items-start justify-between mb-3 print:mb-2">
      <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </div>
);
const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (<span className="inline-block px-2 py-1 text-xs rounded-full bg-zinc-100 border border-zinc-200">{children}</span>);
const ToolbarButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, className = "", ...rest }) => (
  <button {...rest} className={`px-3 py-2 rounded-lg border hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}>{children}</button>
);

const findExamById = (id: string) => EXAMS.find((e) => e.id === id);
function isKnownExamId(id: string, custom: CustomExam[]) { return id.startsWith("custom:") ? custom.some((c) => `custom:${c.id}` === id) : !!findExamById(id); }
function computeRowValue(row: Row, prices: Prices, custom: CustomExam[]) {
  const id = String(row.examId);
  if (id.startsWith("custom:")) { const c = custom.find((cx) => `custom:${cx.id}` === id); return c ? c.priceCents * row.qty : 0; }
  const exam = findExamById(id); if (!exam) return 0;
  let cents = 0; (Object.keys(exam.map) as BaseKey[]).forEach((k) => { cents += (prices[k] ?? 0) * (exam.map[k] ?? 0); });
  return cents * row.qty;
}
function expandEquivalenceCounts(rows: Row[]) {
  const counts: Record<BaseKey, number> = { "Abdominal total": 0, "Rins e Vias": 0, "Transvaginal": 0 };
  rows.forEach((r) => { const id = String(r.examId); if (id.startsWith("custom:")) return; const def = findExamById(id); if (!def) return;
    (Object.keys(def.map) as BaseKey[]).forEach((k) => { counts[k] += (def.map[k] ?? 0) * r.qty; }); });
  return counts;
}

function usePrices() {
  const [prices, setPrices] = useLocalStorage<Prices>("relatorios-precos", {
    "Abdominal total": toCents(134.38), "Rins e Vias": toCents(119.61), "Transvaginal": toCents(109.33),
  });
  return { prices, setPrices } as const;
}
function useClinics() {
  const [clinics, setClinics] = useLocalStorage<Clinic[]>("relatorios-clinicas", [
    { id: "default", name: "Unidade Perdigão / CISPARÁ", place: "Unidade Básica de Saúde", city: "Perdigão" },
  ]);
  const [currentClinicId, setCurrentClinicId] = useLocalStorage<string>("relatorios-clinica-selecionada", clinics[0]?.id || "default");
  useEffect(() => { if (!clinics.find((c) => c.id === currentClinicId) && clinics.length) setCurrentClinicId(clinics[0].id); }, [clinics, currentClinicId, setCurrentClinicId]);
  return { clinics, setClinics, currentClinicId, setCurrentClinicId } as const;
}
function readImageAsDataURL(file: File): Promise<string> { return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(file); }); }
function useCustomExams() {
  const seed = ALLOWED_DIRECT_EXAMS.map((e) => ({ id: slug(e.label), label: e.label, priceCents: toCents(e.price) }));
  const [custom, setCustom] = useLocalStorage<CustomExam[]>("relatorios-custom-exams", seed);
  useEffect(() => { setCustom((prev) => { const filtered = prev.filter((x) => ALLOWED_LABELS_SET.has(x.label.toLowerCase())).map((x) => ({ ...x, id: slug(x.label) })); 
    const existing = new Set(filtered.map((x) => x.label.toLowerCase())); const missing = ALLOWED_DIRECT_EXAMS.filter((e) => !existing.has(e.label.toLowerCase())).map((e) => ({ id: slug(e.label), label: e.label, priceCents: toCents(e.price) }));
    return [...filtered, ...missing]; }); }, []);
  return { custom, setCustom } as const;
}

function buildCSVLines(rows: Row[], prices: Prices, custom: CustomExam[], clinics: Clinic[]) {
  const headers = ["Unidade","Local","Município","Data","Tipo de exame","Observações","Quantidade","Equivalência","Valor parcial (R$)"];
  const lines = [headers.join(";")];
  rows.forEach((r) => {
    const id = String(r.examId);
    const isCustom = id.startsWith("custom:");
    const clinic = clinics.find((c) => c.id === r.clinicId);
    const unidade = clinic?.name ?? r.clinicId;
    const local = clinic?.place ?? "";
    const municipio = clinic?.city ?? "";
    const label = isCustom ? custom.find((c) => `custom:${c.id}` === id)?.label || "Exame" : findExamById(id)?.label || "Exame";
    const eq = isCustom ? "—" : ((Object.entries(findExamById(id)?.map || {}) as [BaseKey, number][]).map(([k, v]) => `${v}× ${k}`).join(" + "));
    const parcial = fromCents(computeRowValue(r, prices, custom));
    const obs = (r.obs ?? "").replace(/[;\r\n]/g, " ").trim();
    lines.push([unidade, local, municipio, fmtBRDate(r.date), label, obs, r.qty, eq, parcial.toFixed(2).replace(".", ",")].join(";"));
  });
  return lines;
}
function exportCSV(rows: Row[], prices: Prices, custom: CustomExam[], clinics: Clinic[], filterDate: string) {
  if (!filterDate) { alert("Selecione a data do atendimento."); return; }
  if (rows.length === 0) { alert("Não há lançamentos para esta data/unidade."); return; }
  const lines = buildCSVLines(rows, prices, custom, clinics);
  const csvText = "\\uFEFF" + lines.join("\\n");
  try {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `relatorio_exames_${fmtBRDate(filterDate)}.csv`; a.rel = "noopener"; a.target = "_blank";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch { try { const dataUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csvText); window.open(dataUrl, "_blank"); } catch { alert("Não foi possível iniciar o download do CSV."); } }
}
async function exportPDF(element: HTMLElement, filename: string) {
  const toHide = Array.from(document.querySelectorAll<HTMLElement>(".no-print, .no-export"));
  const prev = toHide.map((el) => el.style.display);
  toHide.forEach((el) => { el.style.display = "none"; });
  try {
    const [{ jsPDF }, html2canvasMod] = await Promise.all([import("jspdf"), import("html2canvas")]);
    const html2canvas = (html2canvasMod as any).default as (el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>;
    const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight; let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, "", "FAST");
    heightLeft -= pageHeight;
    while (heightLeft > 0) { position -= pageHeight; pdf.addPage(); pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, "", "FAST"); heightLeft -= pageHeight; }
    pdf.save(filename);
  } catch (err) { console.error("[PDF] erro ao gerar", err); alert("Falha ao gerar PDF. Tente Exportar CSV ou use o botão Imprimir/PDF do navegador."); }
  finally { toHide.forEach((el, i) => { el.style.display = prev[i]; }); }
}

const RowEditor: React.FC<{ row: Row; onChange: (r: Row) => void; onRemove: () => void; custom: CustomExam[] }> = ({ row, onChange, onRemove, custom }) => (
  <div className="grid grid-cols-12 gap-2 items-center">
    <select className="col-span-6 md:col-span-6 border rounded-lg px-2 py-2" value={row.examId}
      onChange={(e) => { const newId = e.target.value as ExamId; const isEq = !String(newId).startsWith("custom:") && EQ_IDS.has(String(newId));
        const currentObs = (row.obs ?? "").trim(); const nextObs = currentObs ? row.obs : (isEq ? "Equivalência" : row.obs);
        onChange({ ...row, examId: newId, obs: nextObs }); }}>
      <optgroup label="Equivalências">{EXAMS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
      <optgroup label="Outros exames (valor direto)">{custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.label}</option>)}</optgroup>
    </select>
    <input type="number" min={1} className="col-span-2 md:col-span-2 border rounded-lg px-2 py-2 text-right" value={row.qty}
      onChange={(e) => onChange({ ...row, qty: Math.max(1, Number(e.target.value || 1)) })} />
    <input type="text" placeholder="Observações (opcional)" className="col-span-3 md:col-span-3 border rounded-lg px-2 py-2" value={row.obs ?? ""}
      onChange={(e) => onChange({ ...row, obs: e.target.value })} />
    <button onClick={onRemove} className="col-span-1 md:col-span-1 text-red-600 hover:underline">Remover</button>
  </div>
);

export default function App() {
  const { prices, setPrices } = usePrices();
  const { clinics, setClinics, currentClinicId, setCurrentClinicId } = useClinics();
  const { custom, setCustom } = useCustomExams();

  useEffect(() => { document.title = "Relatório de procedimentos (ultrassonografias) - Dr. Andrew Costa"; }, []);

  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useLocalStorage<Row[]>("relatorios-rows", [
    { id: crypto.randomUUID(), clinicId: currentClinicId, date: today, examId: "obst_rot", qty: 1, obs: "" },
  ]);

  useEffect(() => { setRows((prev) => prev.map((r) => { const id = String(r.examId); const normalized = id.startsWith("eq:") ? id.slice(3) : id; return { ...r, examId: normalized as ExamId, clinicId: r.clinicId || currentClinicId }; })
    .filter((r) => isKnownExamId(String(r.examId), custom))); }, [custom]);

  const [changes, setChanges] = useLocalStorage<ChangeLine[]>("relatorios-changes", []);
  const [changeDraft, setChangeDraft] = useState<Pick<ChangeLine, "patient" | "requested" | "performed" | "reason">>({ patient: "", requested: "", performed: "", reason: "" });

  const [filterDate, setFilterDate] = useState<string>("");
  useEffect(() => { if (!filterDate) return; setRows((prev) => prev.map((r) => (r.clinicId === currentClinicId ? { ...r, date: filterDate } : r))); }, [filterDate, currentClinicId, setRows]);

  const [showSettings, setShowSettings] = useState(false);
  const currentClinic = clinics.find((c) => c.id === currentClinicId);
  const printRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => rows.filter((r) => (!filterDate || r.date === filterDate) && r.clinicId === currentClinicId), [rows, filterDate, currentClinicId]);
  const filteredChanges = useMemo(() => changes.filter((c) => (!filterDate || c.date === filterDate) && c.clinicId === currentClinicId), [changes, filterDate, currentClinicId]);

  const totals = useMemo(() => {
    const subtotalCents = filtered.reduce((acc, r) => acc + computeRowValue(r, prices, custom), 0);
    const equivalenceCounts = expandEquivalenceCounts(filtered);
    const equivalenceValue = (Object.keys(equivalenceCounts) as BaseKey[]).reduce((acc, k) => acc + equivalenceCounts[k] * prices[k], 0);
    const examsCount = filtered.reduce((acc, r) => acc + r.qty, 0);
    return { subtotalCents, equivalenceCounts, equivalenceValue, examsCount };
  }, [filtered, prices, custom]);

  type SumRow = { label: string; qty: number; cents: number };
  const sumRows: SumRow[] = useMemo(() => {
    const eq = expandEquivalenceCounts(filtered);
    const eqRows: SumRow[] = (Object.keys(prices) as BaseKey[]).map((k) => ({ label: k, qty: eq[k], cents: eq[k] * prices[k] }));
    const map = new Map<string, SumRow>();
    filtered.filter((r) => String(r.examId).startsWith("custom:")).forEach((r) => {
      const id = String(r.examId);
      const label = custom.find((c) => `custom:${c.id}` === id)?.label ?? "Exame";
      const cents = computeRowValue(r, prices, custom);
      const prev = map.get(label) ?? { label, qty: 0, cents: 0 };
      prev.qty += r.qty; prev.cents += cents; map.set(label, prev);
    });
    return [...eqRows, ...Array.from(map.values())].filter((r) => r.qty > 0);
  }, [filtered, prices, custom]);

  const grandTotal = useMemo(() => sumRows.reduce((acc, g) => acc + g.cents, 0), [sumRows]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6 print:space-y-3 print:pt-0 print-page" ref={printRef}>
        <header className="print-block report-header">
          <div className="report-logos">
            {currentClinic?.logo && (<img src={currentClinic.logo} alt="Logo da unidade" className="h-10 w-auto object-contain rounded-md border border-zinc-200" />)}
          </div>
          <div className="text-center">
            <h1 className="report-title">Relatório de procedimentos (ultrassonografias) - Dr. Andrew Costa</h1>
            <p className="report-subtitle">
              {currentClinic?.name}{currentClinic?.place ? ` • ${currentClinic.place}` : ""}{currentClinic?.city ? ` • ${currentClinic.city}` : ""}{filterDate ? ` • Data do atendimento: ${fmtBRDate(filterDate)}` : ""}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 no-print">
            <select className="border rounded-lg px-2 py-2" value={currentClinicId} onChange={(e) => setCurrentClinicId(e.target.value)}>
              {clinics.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <input type="date" className="border rounded-lg px-2 py-2" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
            <ToolbarButton onClick={() => setFilterDate("")}>Limpar data</ToolbarButton>
            <ToolbarButton onClick={() => setShowSettings(true)}>Configurações</ToolbarButton>
            <ToolbarButton title={!filterDate ? "Selecione a data para imprimir" : filtered.length === 0 ? "Sem lançamentos" : "Imprimir / salvar em PDF"}
              disabled={!filterDate || filtered.length === 0}
              onClick={() => { if (!filterDate) return alert("Selecione a data do atendimento."); if (filtered.length === 0) return alert("Não há lançamentos para esta data/unidade."); window.print(); }}>
              Imprimir / PDF
            </ToolbarButton>
            <ToolbarButton className="no-export" title={!filterDate ? "Selecione a data para gerar PDF (arquivo)" : filtered.length === 0 ? "Sem lançamentos" : "Gerar PDF (arquivo)"}
              disabled={!filterDate || filtered.length === 0}
              onClick={async () => { if (!filterDate) return alert("Selecione a data do atendimento."); if (filtered.length === 0) return alert("Não há lançamentos para esta data/unidade.");
                if (!printRef.current) return alert("Área de impressão não encontrada."); await exportPDF(printRef.current, `relatorio_exames_${fmtBRDate(filterDate)}.pdf`); }}>
              Gerar PDF
            </ToolbarButton>
            <ToolbarButton title={!filterDate ? "Selecione a data para exportar" : filtered.length === 0 ? "Sem lançamentos" : "Exportar CSV do dia filtrado"}
              disabled={!filterDate || filtered.length === 0} onClick={() => exportCSV(filtered, prices, custom, clinics, filterDate)}>
              Exportar CSV
            </ToolbarButton>
          </div>
        </header>

        <Card title="Exames do dia" right={<Badge>{filtered.length} linha(s)</Badge>}>
          <div className="space-y-3">
            {rows.filter((r) => r.clinicId === currentClinicId).map((row) => (
              <RowEditor key={row.id} row={row} custom={custom}
                onChange={(r) => setRows((prev) => prev.map((x) => (x.id === row.id ? { ...r, clinicId: currentClinicId } : x)))}
                onRemove={() => setRows((prev) => prev.filter((x) => x.id !== row.id))}
              />
            ))}
            <div className="pt-2 flex gap-2 no-print">
              <button className="px-4 py-2 rounded-lg bg-zinc-900 text-white"
                onClick={() => setRows((prev) => [...prev, { id: crypto.randomUUID(), clinicId: currentClinicId, date: filterDate || new Date().toISOString().slice(0, 10), examId: "obst_rot", qty: 1, obs: "" }])}>
                Adicionar linha
              </button>
              <button className="px-4 py-2 rounded-lg border" onClick={() => setRows((prev) => prev.filter((r) => r.clinicId !== currentClinicId))}>Limpar desta unidade</button>
            </div>
          </div>
        </Card>

        <div className="grid md:grid-cols-2 gap-6 print:grid-cols-2">
          <Card title="Resumo do período filtrado" right={<Badge>{totals.examsCount} exame(s)</Badge>}>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span>Total (exames reais)</span><strong>{BRL(fromCents(totals.subtotalCents))}</strong></div>
              <div className="text-xs text-zinc-500">* Calculado pelas equivalências definidas para cada tipo.</div>
              <hr className="my-2 border-zinc-200" />
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(prices) as BaseKey[]).map((k) => (
                  <div key={k} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                    <span>{k} <span className="text-xs text-zinc-500">({BRL(fromCents(prices[k]))})</span></span>
                    <strong>{totals.equivalenceCounts[k]}×</strong>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3"><span>Valor teórico pelas equivalências agregadas</span><strong>{BRL(fromCents(totals.equivalenceValue))}</strong></div>
            </div>
          </Card>

          <Card title="Detalhamento (linhas filtradas)">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-zinc-200">
                    <th className="py-2 pr-2">Tipo de exame</th>
                    <th className="py-2 pr-2">Observações</th>
                    <th className="py-2 pr-2 text-right">Qtde</th>
                    <th className="py-2 pr-2">Equivalência</th>
                    <th className="py-2 pr-2 text-right">Parcial</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const id = String(r.examId);
                    const isCustom = id.startsWith("custom:");
                    const def = isCustom ? undefined : findExamById(id);
                    const label = isCustom ? (custom.find((c) => `custom:${c.id}` === id)?.label || "Exame") : (def?.label || "Exame");
                    const eq = isCustom ? "—" : ((Object.entries(def?.map || {}) as [BaseKey, number][]).map(([k, v]) => `${v}× ${k}`).join(" + "));
                    const parcial = fromCents(computeRowValue(r, prices, custom));
                    const isEqRow = !isCustom && EQ_IDS.has(id);
                    return (
                      <tr key={r.id} className={`border-b border-zinc-100 ${isEqRow ? "font-semibold" : ""}`}>
                        <td className="py-2 pr-2">{label}</td>
                        <td className="py-2 pr-2">{(r.obs ?? "").trim()}</td>
                        <td className="py-2 pr-2 text-right">{r.qty}</td>
                        <td className="py-2 pr-2">{eq}</td>
                        <td className="py-2 pr-2 text-right">{BRL(parcial)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Somatório por tipo de exame">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-zinc-200">
                  <th className="py-2 pr-2">Exame</th>
                  <th className="py-2 pr-2 text-right">Quantidade</th>
                  <th className="py-2 pr-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {sumRows.map((g) => (
                  <tr key={g.label} className="border-b border-zinc-100">
                    <td className="py-2 pr-2">{g.label}</td>
                    <td className="py-2 pr-2 text-right">{g.qty}</td>
                    <td className="py-2 pr-2 text-right">{BRL(fromCents(g.cents))}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-2 font-semibold">Total geral</td>
                  <td className="py-2 pr-2 text-right font-semibold">{sumRows.reduce((acc, g) => acc + g.qty, 0)}</td>
                  <td className="py-2 pr-2 text-right font-semibold">{BRL(fromCents(grandTotal))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <footer className="text-xs text-zinc-500">
          * Equivalências fixas: Obstétrico de rotina → 1× Abdominal total; Morfológico 1º → 1× Abdominal total + 1× Rins e Vias; Morfológico 2º → 1× Abdominal total + 1× Rins e Vias + 1× Transvaginal; Mamas/Mamas e Axilas → 2× Rins e Vias.
        </footer>
      </div>
    </div>
  );
}
