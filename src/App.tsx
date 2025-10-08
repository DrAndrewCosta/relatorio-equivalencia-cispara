import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type BaseKey = "Abdominal total" | "Rins e Vias" | "Transvaginal";
type Prices = Record<BaseKey, number>;
type EqMap = Partial<Record<BaseKey, number>>;
type Clinic = { id: string; name: string; place?: string; city?: string; logo?: string };
type ExamId = "obst_rot" | "morf_1tri" | "morf_2tri" | "mamas_axilas" | `custom:${string}`;
type Row = { id: string; clinicId: string; date: string; examId: ExamId; qty: number; obs?: string };
type DetailedRow = Row & {
  label: string;
  equivalence: string;
  partialCents: number;
  obsText: string;
};

const STORAGE_KEYS = {
  prices: "relatorios-precos",
  clinics: "relatorios-clinicas",
  currentClinic: "relatorios-current-clinic",
  rows: "relatorios-rows",
  filterDate: "relatorios-filter-date",
} as const;

const BASE_KEYS: BaseKey[] = ["Abdominal total", "Rins e Vias", "Transvaginal"];

const EXAMS: ReadonlyArray<{ id: ExamId; label: string; map: EqMap }> = [
  { id: "obst_rot", label: "Obstétrico de rotina (pré-natal)", map: { "Abdominal total": 1 } },
  {
    id: "morf_1tri",
    label: "Obstétrico morfológico (1º trimestre)",
    map: { "Abdominal total": 1, "Rins e Vias": 1 },
  },
  {
    id: "morf_2tri",
    label: "Morfológico do 2º trimestre",
    map: { "Abdominal total": 1, "Rins e Vias": 1, "Transvaginal": 1 },
  },
  { id: "mamas_axilas", label: "Mamas / Mamas e Axilas", map: { "Rins e Vias": 2 } },
];

const ALLOWED_DIRECT_EXAMS = [
  { label: "Ultrassonografia - rins e vias urinárias", price: 119.61 },
  { label: "Ultrassonografia - abdominal total", price: 134.38 },
  { label: "Ultrassonografia - transvaginal", price: 109.33 },
  { label: "Ultrassonografia - abdômen superior", price: 113.89 },
  { label: "Ultrassonografia - parede abdominal", price: 114.89 },
  { label: "Ultrassonografia - pélvica (feminino)", price: 108.47 },
  { label: "Ultrassonografia - próstata por via abdominal", price: 115.85 },
  { label: "Ultrassonografia - região inguinal", price: 120.95 },
  { label: "Ultrassonografia - partes moles", price: 127.06 },
  { label: "Ultrassonografia - bolsa escrotal", price: 126.5 },
  { label: "Ultrassonografia - tireoide", price: 129.9 },
  { label: "Ultrassonografia - tireóide com doppler", price: 158.13 },
  { label: "Ultrassonografia - cervical", price: 131.5 },
  { label: "Ultrassonografia cervical com doppler", price: 187.8 },
  { label: "Ultrassonografia - glândulas salivares", price: 135 },
  { label: "Ultrassonografia - transvaginal com doppler", price: 163.19 },
  { label: "Ultrassonografia - obstétrica Perfil Biofísico Fetal", price: 157.35 },
  { label: "Ultrassonografia - Translucência Nucal", price: 138.94 },
  { label: "Ultrassonografia - mamas", price: 140 },
  { label: "Ultrassonografia - axilas", price: 118 },
] as const;

const EXAMS_BY_ID = new Map(EXAMS.map((exam) => [exam.id, exam] as const));

function toCents(n: number): number {
  return Math.round(n * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function BRL(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}

const DEFAULT_PRICES: Prices = {
  "Abdominal total": toCents(134.38),
  "Rins e Vias": toCents(119.61),
  "Transvaginal": toCents(109.33),
};

const DEFAULT_CLINICS: Clinic[] = [
  {
    id: "cispara",
    name: "CISPARÁ",
    place: "Unidade básica",
    city: "Perdigão/MG",
  },
];

function fmtBRDate(iso?: string): string {
  if (!iso) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return iso.split("-").reverse().join("-");
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn("Erro ao ler localStorage", error);
    return fallback;
  }
}

function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    return safeJsonParse<T>(window.localStorage.getItem(key), initial);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn("Erro ao gravar localStorage", error);
    }
  }, [key, state]);

  return [state, setState] as const;
}

function findExamById(id: ExamId) {
  return EXAMS_BY_ID.get(id);
}

function describeEquivalenceMap(map?: EqMap): string {
  if (!map) return "—";
  const entries = Object.entries(map)
    .filter(([, value]) => (value ?? 0) > 0)
    .map(([key, value]) => `${value}× ${key}`);
  return entries.length > 0 ? entries.join(" + ") : "—";
}

function normalizeLabel(raw: string): string {
  const cleaned = raw.replace(/^Ultrassonografia\s*-\s*/i, "").trim();
  if (!cleaned) return "Exame";

  const normalized = cleaned.toLowerCase();
  if (normalized.includes("abdominal total") || normalized.includes("abdômen total")) {
    return "Abdominal total";
  }
  if (normalized.includes("rins e vias")) {
    return "Rins e Vias";
  }
  if (normalized.includes("transvaginal")) {
    return "Transvaginal";
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isCustomExamId(examId: ExamId): boolean {
  return examId.startsWith("custom:");
}

function getCustomExamIndex(examId: ExamId): number {
  if (!isCustomExamId(examId)) return -1;
  const [, index] = examId.split(":");
  return Number.parseInt(index, 10) - 1;
}

function getCustomExamDefinition(examId: ExamId) {
  const index = getCustomExamIndex(examId);
  return Number.isInteger(index) && index >= 0 ? ALLOWED_DIRECT_EXAMS[index] : undefined;
}

function computeRowValue(row: Row, prices: Prices): number {
  if (isCustomExamId(row.examId)) {
    const baseExam = getCustomExamDefinition(row.examId);
    return baseExam ? toCents(baseExam.price) * row.qty : 0;
  }

  const definition = findExamById(row.examId);
  if (!definition) return 0;

  const cents = (Object.keys(definition.map) as BaseKey[]).reduce((sum, key) => {
    const quantity = definition.map?.[key] ?? 0;
    return sum + prices[key] * quantity;
  }, 0);

  return cents * row.qty;
}

function expandEquivalenceCounts(rows: Row[]): Record<BaseKey, number> {
  const counts: Record<BaseKey, number> = {
    "Abdominal total": 0,
    "Rins e Vias": 0,
    "Transvaginal": 0,
  };

  rows.forEach((row) => {
    if (isCustomExamId(row.examId)) return;
    const definition = findExamById(row.examId);
    if (!definition) return;

    (Object.keys(definition.map) as BaseKey[]).forEach((key) => {
      counts[key] += (definition.map?.[key] ?? 0) * row.qty;
    });
  });

  return counts;
}

function usePrices() {
  const [prices, setPrices] = useLocalStorage<Prices>(STORAGE_KEYS.prices, DEFAULT_PRICES);
  return { prices, setPrices } as const;
}

function useClinics() {
  const [clinics, setClinics] = useLocalStorage<Clinic[]>(STORAGE_KEYS.clinics, DEFAULT_CLINICS);
  const [currentClinicId, setCurrentClinicId] = useLocalStorage<string>(
    STORAGE_KEYS.currentClinic,
    DEFAULT_CLINICS[0]?.id ?? ""
  );
  return { clinics, setClinics, currentClinicId, setCurrentClinicId } as const;
}

function sanitizeCsvCell(value: string): string {
  return value.replace(/[;\r\n]+/g, " ").trim();
}

function buildCsvLines(rows: DetailedRow[], clinics: Clinic[]) {
  const headers = [
    "Unidade",
    "Local",
    "Município",
    "Data do atendimento",
    "Tipo de exame",
    "Observações",
    "Quantidade",
    "Equivalência",
  ];

  const lines = [headers.join(";")];

  rows.forEach((row) => {
    const clinic = clinics.find((item) => item.id === row.clinicId);
    const unidade = clinic?.name ?? row.clinicId;
    const local = clinic?.place ?? "";
    const municipio = clinic?.city ?? "";
    lines.push(
      [
        unidade,
        local,
        municipio,
        fmtBRDate(row.date),
        row.label,
        sanitizeCsvCell(row.obsText || "—"),
        row.qty,
        row.equivalence,
      ].join(";")
    );
  });

  return lines;
}

function exportCsv(rows: DetailedRow[], clinics: Clinic[]) {
  const csv = "\uFEFF" + buildCsvLines(rows, clinics).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `relatorio_exames_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const RowEditor: React.FC<{
  row: Row;
  onChange: (row: Row) => void;
  onRemove: () => void;
}> = ({ row, onChange, onRemove }) => {
  const handleQuantityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseInt(event.target.value, 10);
    const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    onChange({ ...row, qty: safeValue });
  };

  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <select
        className="col-span-7 border rounded-lg px-2 py-2"
        value={row.examId}
        onChange={(event) => onChange({ ...row, examId: event.target.value as ExamId })}
      >
        <optgroup label="Equivalências">
          {EXAMS.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Outros exames (valor direto)">
          {ALLOWED_DIRECT_EXAMS.map((exam, index) => (
            <option key={exam.label} value={`custom:${index + 1}`}>
              {normalizeLabel(exam.label)}
            </option>
          ))}
        </optgroup>
      </select>
      <input
        type="number"
        min={1}
        className="col-span-2 border rounded-lg px-2 py-2 text-right"
        value={row.qty}
        onChange={handleQuantityChange}
      />
      <input
        type="text"
        className="col-span-2 border rounded-lg px-2 py-2"
        placeholder="Observações (opcional)"
        value={row.obs ?? ""}
        onChange={(event) => onChange({ ...row, obs: event.target.value })}
      />
      <button type="button" className="col-span-1 text-red-600 hover:underline" onClick={onRemove}>
        Remover
      </button>
    </div>
  );
};

function createRow(clinicId: string, date: string): Row {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

  return {
    id,
    clinicId,
    date,
    examId: "obst_rot",
    qty: 1,
    obs: "",
  };
}

function buildDetailedRow(row: Row, prices: Prices): DetailedRow {
  const isCustom = isCustomExamId(row.examId);
  const definition = isCustom ? undefined : findExamById(row.examId);
  const customExam = isCustom ? getCustomExamDefinition(row.examId) : undefined;

  const label = isCustom ? normalizeLabel(customExam?.label ?? "Exame") : definition?.label ?? "Exame";
  const equivalence = isCustom ? "—" : describeEquivalenceMap(definition?.map);
  const partialCents = computeRowValue(row, prices);
  const obsText = (row.obs ?? "").trim();

  return { ...row, label, equivalence, partialCents, obsText };
}

export default function App() {
  const today = new Date().toISOString().slice(0, 10);

  const { prices } = usePrices();
  const { clinics, currentClinicId, setCurrentClinicId } = useClinics();

  const [rows, setRows] = useLocalStorage<Row[]>(STORAGE_KEYS.rows, [
    createRow(DEFAULT_CLINICS[0]?.id ?? "cispara", today),
  ]);
  const [filterDate, setFilterDate] = useLocalStorage<string>(STORAGE_KEYS.filterDate, today);

  const printRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const currentClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === currentClinicId),
    [clinics, currentClinicId]
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => row.clinicId === currentClinicId && row.date === filterDate),
    [rows, currentClinicId, filterDate]
  );

  const detailedRows = useMemo(
    () => filteredRows.map((row) => buildDetailedRow(row, prices)),
    [filteredRows, prices]
  );

  const detailMap = useMemo(() => new Map(detailedRows.map((row) => [row.id, row])), [detailedRows]);

  const equivalenceCounts = useMemo(() => expandEquivalenceCounts(filteredRows), [filteredRows]);

  const equivalenceRows = useMemo(
    () =>
      BASE_KEYS.map((key) => ({
        key,
        qty: equivalenceCounts[key],
        cents: equivalenceCounts[key] * prices[key],
      })).filter((row) => row.qty > 0),
    [equivalenceCounts, prices]
  );

  const consolidated = useMemo(() => {
    const accumulator = new Map<string, { qty: number; cents: number }>();

    equivalenceRows.forEach((row) => {
      accumulator.set(row.key, { qty: row.qty, cents: row.cents });
    });

    filteredRows.forEach((row) => {
      if (!isCustomExamId(row.examId)) return;
      const custom = getCustomExamDefinition(row.examId);
      if (!custom) return;

      const label = normalizeLabel(custom.label);
      const entry = accumulator.get(label) ?? { qty: 0, cents: 0 };
      entry.qty += row.qty;
      entry.cents += toCents(custom.price) * row.qty;
      accumulator.set(label, entry);
    });

    const entries = Array.from(accumulator.entries())
      .map(([label, value]) => ({ label, qty: value.qty, cents: value.cents }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const totalQty = entries.reduce((sum, row) => sum + row.qty, 0);
    const totalCents = entries.reduce((sum, row) => sum + row.cents, 0);

    return { rows: entries, totalQty, totalCents };
  }, [equivalenceRows, filteredRows]);

  const hasDataForExport = filterDate !== "" && filteredRows.length > 0;

  const handleRowChange = useCallback(
    (updatedRow: Row) => {
      setRows((previous) => previous.map((row) => (row.id === updatedRow.id ? updatedRow : row)));
    },
    [setRows]
  );

  const handleRowRemove = useCallback(
    (id: string) => {
      setRows((previous) => previous.filter((row) => row.id !== id));
    },
    [setRows]
  );

  const handleAddRow = useCallback(() => {
    if (!currentClinicId) return;
    const date = filterDate || today;
    if (!filterDate) setFilterDate(date);

    const newRow = createRow(currentClinicId, date);
    setRows((previous) => [...previous, newRow]);
  }, [currentClinicId, filterDate, setFilterDate, setRows, today]);

  const handleDuplicateRow = useCallback(
    (row: Row) => {
      const newRow = { ...row, id: createRow(row.clinicId, row.date).id };
      setRows((previous) => [...previous, newRow]);
    },
    [setRows]
  );

  const handleGeneratePdf = useCallback(async () => {
    if (!hasDataForExport || !printRef.current) return;

    setIsGeneratingPdf(true);
    try {
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: "#fff",
        useCORS: true,
      });

      const image = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const width = pdf.internal.pageSize.getWidth();
      const height = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const maxWidth = width - margin * 2;
      const maxHeight = height - margin * 2;
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const imageWidth = canvas.width * ratio;
      const imageHeight = canvas.height * ratio;

      pdf.addImage(
        image,
        "PNG",
        (width - imageWidth) / 2,
        (height - imageHeight) / 2,
        imageWidth,
        imageHeight,
        undefined,
        "FAST"
      );

      pdf.save(`relatorio_exames_${fmtBRDate(filterDate)}.pdf`);
    } catch (error) {
      console.error("Erro ao gerar PDF", error);
      alert("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [filterDate, hasDataForExport]);

  return (
    <div className="min-h-screen">
      <div className="no-print">
        <div className="max-w-5xl mx-auto py-4 px-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-2">Unidade / Data</h2>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="border rounded-lg px-2 py-2"
                  value={currentClinicId}
                  onChange={(event) => setCurrentClinicId(event.target.value)}
                >
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
                <input
                  className="border rounded-lg px-2 py-2"
                  type="date"
                  value={filterDate}
                  onChange={(event) => setFilterDate(event.target.value)}
                />
              </div>
            </div>
            <div className="border rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-2">Exportações</h2>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!hasDataForExport || isGeneratingPdf}
                  onClick={handleGeneratePdf}
                >
                  {isGeneratingPdf ? "Gerando..." : "Gerar PDF"}
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!hasDataForExport}
                  onClick={() => exportCsv(detailedRows, clinics)}
                >
                  Exportar CSV
                </button>
              </div>
            </div>
          </div>

          <div className="border rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Lançamentos do dia selecionado</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border"
                  onClick={handleAddRow}
                  disabled={!currentClinicId}
                >
                  Adicionar exame
                </button>
                {filteredRows.length > 0 && (
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border"
                    onClick={() => handleDuplicateRow(filteredRows[filteredRows.length - 1])}
                  >
                    Duplicar último
                  </button>
                )}
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nenhum lançamento para esta unidade/data. Clique em “Adicionar exame” para começar.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredRows.map((row) => (
                  <div key={row.id} className="border rounded-xl p-3">
                    <RowEditor row={row} onChange={handleRowChange} onRemove={() => handleRowRemove(row.id)} />
                    <div className="mt-2 text-sm text-zinc-500">
                      Parcial calculado: {BRL(fromCents(detailMap.get(row.id)?.partialCents ?? 0))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="report-paper" ref={printRef}>
        <header className="report-header">
          <div className="flex items-center justify-center">
            <div className="report-logo flex items-center justify-center text-xs text-zinc-400">Logo</div>
          </div>
          <div className="flex flex-col -ml-16 md:ml-0">
            <div className="report-title">Relatório de Procedimentos – Ultrassonografias</div>
            <div className="report-subtitle">
              Dr. Andrew Costa – ECHO VITAE SERVIÇOS MÉDICOS LTDA (CNPJ 57.953.966/0001-60)
            </div>
          </div>
        </header>
        <div className="report-meta">
          <div className="box">
            <div className="label">Unidade</div>
            <div className="value">{currentClinic?.name ?? "—"}</div>
          </div>
          <div className="box">
            <div className="label">Local</div>
            <div className="value">{currentClinic?.place ?? "—"}</div>
          </div>
          <div className="box">
            <div className="label">Município</div>
            <div className="value">{currentClinic?.city ?? "—"}</div>
          </div>
          <div className="box">
            <div className="label">Data do atendimento</div>
            <div className="value">{fmtBRDate(filterDate)}</div>
          </div>
        </div>

        <section className="report-section">
          <h2 className="report-section-title">Exames do dia</h2>
          {detailedRows.length > 0 ? (
            <div className="report-table-wrapper">
              <table className="report-table" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col />
                  <col style={{ width: "38ch" }} />
                  <col style={{ width: "64px" }} />
                  <col />
                  <col style={{ width: "110px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Tipo de exame</th>
                    <th>Observações</th>
                    <th className="right">Qtde</th>
                    <th>Equivalência</th>
                    <th className="right">Parcial</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td style={{ hyphens: "auto", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {row.obsText || "—"}
                      </td>
                      <td className="right">{row.qty}</td>
                      <td>{row.equivalence}</td>
                      <td className="right">{BRL(fromCents(row.partialCents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-empty">Nenhum lançamento encontrado para a data selecionada.</p>
          )}
        </section>

        <section className="report-section">
          <h2 className="report-section-title">Equivalências de obstétricos, morfológicos e mamas</h2>
          {equivalenceRows.length > 0 ? (
            <div className="report-table-wrapper">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Base</th>
                    <th className="right">Quantidade</th>
                    <th className="right">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {equivalenceRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td className="right">{row.qty}</td>
                      <td className="right">{BRL(fromCents(row.cents))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} className="right font-semibold">
                      Total geral
                    </td>
                    <td className="right font-semibold">
                      {BRL(fromCents(equivalenceRows.reduce((sum, current) => sum + current.cents, 0)))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-empty">Ainda não há consolidação para esta unidade/data.</p>
          )}
        </section>

        <section className="report-section">
          <h2 className="report-section-title">Relatório Consolidado (por tipo de exame)</h2>
          {consolidated.rows.length > 0 ? (
            <div className="report-table-wrapper">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="right">Quantidade</th>
                    <th className="right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidated.rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="right">{row.qty}</td>
                      <td className="right">{BRL(fromCents(row.cents))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="right font-semibold">Total geral</td>
                    <td className="right font-semibold">{consolidated.totalQty}</td>
                    <td className="right font-semibold">{BRL(fromCents(consolidated.totalCents))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-empty">Sem dados para consolidar.</p>
          )}
        </section>

        <footer className="report-footer">
          <p>
            * Equivalências fixas: Obstétrico de rotina → 1× Abdominal total; Morfológico 1º trimestre → 1× Abdominal total + 1×
            Rins e Vias; Morfológico do 2º trimestre → 1× Abdominal total + 1× Rins e Vias + 1× Transvaginal; Mamas/Mamas e Axilas
            → 2× Rins e Vias.
          </p>
          <p className="report-footer-note">Relatório Gerado pelo sistema LILI – Laudos Inteligentes.</p>
        </footer>
      </div>
    </div>
  );
}
