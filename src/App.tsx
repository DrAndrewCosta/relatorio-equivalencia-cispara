import React, { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type BaseKey = "Abdominal total" | "Rins e Vias" | "Transvaginal";
type Prices = Record<BaseKey, number>;
type EqMap = Partial<Record<BaseKey, number>>;
type Clinic = { id: string; name: string; place?: string; city?: string; logo?: string };
type ExamId = "obst_rot" | "morf_1tri" | "morf_2tri" | "mamas_axilas" | `custom:${string}`;
type Row = { id: string; clinicId: string; date: string; examId: ExamId; qty: number; obs?: string };

const BASE_KEYS: BaseKey[] = ["Abdominal total","Rins e Vias","Transvaginal"];
const EXAMS: { id: ExamId; label: string; map: EqMap }[] = [
  { id: "obst_rot", label: "Obstétrico de rotina (pré-natal)", map: { "Abdominal total": 1 } },
  { id: "morf_1tri", label: "Obstétrico morfológico (1º trimestre)", map: { "Abdominal total": 1, "Rins e Vias": 1 } },
  { id: "morf_2tri", label: "Morfológico do 2º trimestre", map: { "Abdominal total": 1, "Rins e Vias": 1, "Transvaginal": 1 } },
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
  { label: "Ultrassonografia - bolsa escrotal", price: 126.50 },
  { label: "Ultrassonografia - tireoide", price: 129.90 },
  { label: "Ultrassonografia - tireóide com doppler", price: 158.13 },
  { label: "Ultrassonografia - cervical", price: 131.50 },
  { label: "Ultrassonografia cervical com doppler", price: 187.80 },
  { label: "Ultrassonografia - glândulas salivares", price: 135.00 },
  { label: "Ultrassonografia - transvaginal com doppler", price: 163.19 },
  { label: "Ultrassonografia - obstétrica Perfil Biofísico Fetal", price: 157.35 },
  { label: "Ultrassonografia - Translucência Nucal", price: 138.94 },
  { label: "Ultrassonografia - mamas", price: 140.00 },
  { label: "Ultrassonografia - axilas", price: 118.00 },
] as const;

const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRDate = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("-") : "");

function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState] as const;
}
function findExamById(id: string) { return EXAMS.find(e => e.id === (id as ExamId)); }
function describeEquivalenceMap(map?: EqMap) { if (!map) return "—"; const entries = Object.entries(map).filter(([,v])=> (v??0)>0).map(([k,v])=> `${v}× ${k}`); return entries.length? entries.join(" + ") : "—"; }
function normalizeLabel(raw: string){ const s = raw.replace(/^Ultrassonografia\s*-\s*/i,"").trim(); const low=s.toLowerCase(); if(low.includes("abdominal total")||low.includes("abdômen total"))return "Abdominal total"; if(low.includes("rins e vias"))return "Rins e Vias"; if(low.includes("transvaginal"))return "Transvaginal"; return s[0]?.toUpperCase()+s.slice(1); }
function computeRowValue(row: Row, prices: Prices) {
  const id = String(row.examId);
  if (id.startsWith("custom:")) { const idx = Number(id.split(":")[1]) - 1; const base = ALLOWED_DIRECT_EXAMS[idx]; return base ? toCents(base.price) * row.qty : 0; }
  const def = findExamById(id); if(!def) return 0;
  let cents = 0; (Object.keys(def.map) as BaseKey[]).forEach(k => { cents += (prices[k]||0) * (def.map?.[k]||0); });
  return cents * row.qty;
}
function expandEquivalenceCounts(rows: Row[]) {
  const counts: Record<BaseKey, number> = { "Abdominal total":0, "Rins e Vias":0, "Transvaginal":0 };
  rows.forEach(r=>{ const id=String(r.examId); if(id.startsWith("custom:")) return; const def=findExamById(id); if(!def) return; (Object.keys(def.map) as BaseKey[]).forEach(k=>{ counts[k]+= (def.map?.[k]||0)*r.qty; }); });
  return counts;
}

function usePrices(){ const [prices]=useLocalStorage<Prices>("relatorios-precos",{ "Abdominal total": toCents(134.38), "Rins e Vias": toCents(119.61), "Transvaginal": toCents(109.33) }); return {prices} as const; }
function useClinics(){ const [clinics]=useLocalStorage<Clinic[]>("relatorios-clinicas",[ { id:"cispara", name:"CISPARÁ", place:"Unidade básica", city:"Perdigão/MG" } ]); const [currentClinicId,setCurrentClinicId]=useLocalStorage<string>("relatorios-current-clinic","cispara"); return {clinics,currentClinicId,setCurrentClinicId} as const; }

function buildCSVLines(rows: Row[], clinics: Clinic[]){
  const headers=["Unidade","Local","Município","Data do atendimento","Tipo de exame","Observações","Quantidade","Equivalência"];
  const lines=[headers.join(";")];
  rows.forEach(r=>{ const id=String(r.examId); const clinic=clinics.find(c=>c.id===r.clinicId); const unidade=clinic?.name??r.clinicId; const local=clinic?.place??""; const municipio=clinic?.city??""; const label=id.startsWith("custom:")? normalizeLabel(ALLOWED_DIRECT_EXAMS[Number(id.split(":")[1])-1]?.label||"Exame") : (findExamById(id)?.label||"Exame"); const eq=id.startsWith("custom:")? "—":describeEquivalenceMap(findExamById(id)?.map); const obs=(r.obs??"").replace(/[;\r\n]/g," ").trim(); lines.push([unidade,local,municipio,fmtBRDate(r.date),label,obs,r.qty,eq].join(";")); });
  return lines;
}
function exportCSV(rows: Row[], clinics: Clinic[]){ const csv="\uFEFF"+buildCSVLines(rows,clinics).join("\n"); const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`relatorio_exames_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0); }

const RowEditor: React.FC<{row: Row; onChange: (r: Row)=>void; onRemove: ()=>void}> = ({row,onChange,onRemove}) => (
  <div className="grid grid-cols-12 gap-2 items-center">
    <select className="col-span-7 border rounded-lg px-2 py-2" value={row.examId} onChange={(e)=> onChange({...row, examId: e.target.value as ExamId})}>
      <optgroup label="Equivalências">
        {EXAMS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </optgroup>
      <optgroup label="Outros exames (valor direto)">
        {ALLOWED_DIRECT_EXAMS.map((x,i)=> <option key={i} value={`custom:${i+1}`}>{normalizeLabel(x.label)}</option>)}
      </optgroup>
    </select>
    <input type="number" min={1} className="col-span-2 border rounded-lg px-2 py-2 text-right" value={row.qty} onChange={(e)=> onChange({...row, qty: Math.max(1, Number(e.target.value||1))})} />
    <input type="text" className="col-span-2 border rounded-lg px-2 py-2" placeholder="Observações (opcional)" value={row.obs??""} onChange={(e)=> onChange({...row, obs: e.target.value})} />
    <button className="col-span-1 text-red-600 hover:underline" onClick={onRemove}>Remover</button>
  </div>
);

export default function App(){
  const {prices}=usePrices();
  const {clinics,currentClinicId,setCurrentClinicId}=useClinics();
  const today=new Date().toISOString().slice(0,10);
  const [rows,setRows]=useLocalStorage<Row[]>("relatorios-rows",[
    {id:crypto.randomUUID(),clinicId:currentClinicId,date:today,examId:"obst_rot",qty:1,obs:""}
  ]);
  const [filterDate,setFilterDate]=useLocalStorage<string>("relatorios-filter-date", today);
  const currentClinic=useMemo(()=> clinics.find(c=>c.id===currentClinicId),[clinics,currentClinicId]);
  const filtered=useMemo(()=> rows.filter(r=> r.clinicId===currentClinicId && r.date===filterDate ),[rows,currentClinicId,filterDate]);

  const detailRows = useMemo(()=> filtered.map(r=>{
    const id=String(r.examId);
    const isCustom=id.startsWith("custom:");
    const def=isCustom?undefined:findExamById(id);
    const idx = isCustom ? (Number(id.split(":")[1])-1) : -1;
    const base = isCustom ? ALLOWED_DIRECT_EXAMS[idx] : undefined;
    const label=isCustom? normalizeLabel(base?.label||'Exame') : (def?.label||'Exame');
    const equivalence=isCustom? "—" : describeEquivalenceMap(def?.map);
    const parcialCents=computeRowValue(r,prices);
    const obsText=(r.obs??'').trim();
    return {...r,label,equivalence,parcialCents,obsText};
  }),[filtered,prices]);

  // Tabela 2 — equivalências
  const eqCounts=useMemo(()=> expandEquivalenceCounts(filtered),[filtered]);
  const eqRows = useMemo(()=> BASE_KEYS
      .map(key=> ({key, qty:eqCounts[key], cents:eqCounts[key]*prices[key]}))
      .filter(r=>r.qty>0), [eqCounts,prices]);

  // Tabela 3 — consolidado final (equivalências + diretos normalizados por label)
  const consolidated = useMemo(()=>{
    const acc: Record<string,{qty:number;cents:number}> = {};
    // Equivalências entram pelo item-base
    eqRows.forEach(e=>{ acc[e.key] = { qty: e.qty, cents: e.cents }; });
    // Diretos: somar por label normalizado com seus preços
    filtered.forEach(r=>{
      const id = String(r.examId);
      if (!id.startsWith("custom:")) return;
      const idx = Number(id.split(":")[1]) - 1;
      const base = ALLOWED_DIRECT_EXAMS[idx];
      if (!base) return;
      const label = normalizeLabel(base.label);
      if (!acc[label]) acc[label] = { qty: 0, cents: 0 };
      acc[label].qty += r.qty;
      acc[label].cents += toCents(base.price) * r.qty;
    });
    const rows = Object.entries(acc).map(([label,v])=>({label, qty:v.qty, cents:v.cents})).sort((a,b)=> a.label.localeCompare(b.label));
    const totalQty = rows.reduce((s,r)=>s+r.qty,0);
    const totalCents = rows.reduce((s,r)=>s+r.cents,0);
    return { rows, totalQty, totalCents };
  },[eqRows, filtered]);

  const printRef=useRef<HTMLDivElement>(null);

  return (<div className="min-h-screen">
    <div className="no-print">
      <div className="max-w-5xl mx-auto py-4 px-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div className="border rounded-2xl p-4">
            <h2 className="text-lg font-semibold mb-2">Unidade / Data</h2>
            <div className="grid grid-cols-2 gap-2">
              <select className="border rounded-lg px-2 py-2" value={currentClinicId} onChange={(e)=>setCurrentClinicId(e.target.value)}>
                {clinics.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="border rounded-lg px-2 py-2" type="date" value={filterDate} onChange={(e)=>setFilterDate(e.target.value)} />
            </div>
          </div>
          <div className="border rounded-2xl p-4">
            <h2 className="text-lg font-semibold mb-2">Exportações</h2>
            <div className="flex gap-2 flex-wrap">
              <button className="px-3 py-2 rounded-lg border" disabled={!filterDate||filtered.length===0} onClick={async()=>{
                if(!filterDate||!printRef.current||filtered.length===0) return;
                const el=printRef.current;
                const canvas=await html2canvas(el,{scale:2,backgroundColor:'#fff',useCORS:true});
                const img=canvas.toDataURL('image/png');
                const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
                const w=pdf.internal.pageSize.getWidth(), h=pdf.internal.pageSize.getHeight();
                const m=8, maxW=w-2*m, maxH=h-2*m;
                const r=Math.min(maxW/canvas.width,maxH/canvas.height);
                const iw=canvas.width*r, ih=canvas.height*r;
                pdf.addImage(img,'PNG',(w-iw)/2,(h-ih)/2,iw,ih,'','FAST');
                pdf.save(`relatorio_exames_${fmtBRDate(filterDate)}.pdf`);
              }}>Gerar PDF</button>
              <button className="px-3 py-2 rounded-lg border" disabled={!filterDate||filtered.length===0} onClick={()=> exportCSV(filtered, clinics)}>Exportar CSV</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div className="report-paper" ref={printRef}>
      <header className="report-header">
        <div className="flex items-center justify-center"><div className="report-logo flex items-center justify-center text-xs text-zinc-400">Logo</div></div>
        <div className="flex flex-col -ml-16 md:ml-0">
          <div className="report-title">Relatório de Procedimentos – Ultrassonografias</div>
          <div className="report-subtitle">Dr. Andrew Costa – ECHO VITAE SERVIÇOS MÉDICOS LTDA (CNPJ 57.953.966/0001-60)</div>
        </div>
      </header>
      <div className="report-meta">
        <div className="box"><div className="label">Unidade</div><div className="value">{currentClinic?.name ?? "—"}</div></div>
        <div className="box"><div className="label">Local</div><div className="value">{currentClinic?.place ?? "—"}</div></div>
        <div className="box"><div className="label">Município</div><div className="value">{currentClinic?.city ?? "—"}</div></div>
        <div className="box"><div className="label">Data do atendimento</div><div className="value">{fmtBRDate(filterDate)}</div></div>
      </div>

      {/* Tabela 1 */}
      <section className="report-section">
        <h2 className="report-section-title">Exames do dia</h2>
        {filtered.length>0? (
          <div className="report-table-wrapper">
            <table className="report-table" style={{tableLayout:'fixed'}}>
              <colgroup><col /><col style={{width:'38ch'}} /><col style={{width:'64px'}} /><col /><col style={{width:'110px'}} /></colgroup>
              <thead><tr><th>Tipo de exame</th><th>Observações</th><th className="right">Qtde</th><th>Equivalência</th><th className="right">Parcial</th></tr></thead>
              <tbody>
                {filtered.map(r=>{
                  const d=detailRows.find(x=>x.id===r.id)!;
                  return (<tr key={r.id}>
                    <td>{d.label}</td>
                    <td style={{hyphens:'auto',overflowWrap:'anywhere',wordBreak:'break-word'}}>{d.obsText || "—"}</td>
                    <td className="right">{d.qty}</td>
                    <td>{d.equivalence}</td>
                    <td className="right">{BRL(fromCents(d.parcialCents))}</td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
        ) : (<p className="report-empty">Nenhum lançamento encontrado para a data selecionada.</p>)}
      </section>

      {/* Tabela 2 */}
      <section className="report-section">
        <h2 className="report-section-title">Equivalências de obstétricos, morfológicos e mamas</h2>
        {eqRows.length>0? (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead><tr><th>Base</th><th className="right">Quantidade</th><th className="right">Valor total</th></tr></thead>
              <tbody>{eqRows.map(e=>(<tr key={e.key}><td>{e.key}</td><td className="right">{e.qty}</td><td className="right">{BRL(fromCents(e.cents))}</td></tr>))}
                <tr><td colSpan={2} className="right font-semibold">Total geral</td><td className="right font-semibold">{BRL(fromCents(eqRows.reduce((s,x)=>s+x.cents,0)))}</td></tr>
              </tbody>
            </table>
          </div>
        ):(<p className="report-empty">Ainda não há consolidação para esta unidade/data.</p>)}
      </section>

      {/* Tabela 3 */}
      <section className="report-section">
        <h2 className="report-section-title">Relatório Consolidado (por tipo de exame)</h2>
        {consolidated.rows.length>0? (
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead><tr><th>Tipo</th><th className="right">Quantidade</th><th className="right">Subtotal</th></tr></thead>
              <tbody>
                {consolidated.rows.map(r=> (<tr key={r.label}><td>{r.label}</td><td className="right">{r.qty}</td><td className="right">{BRL(fromCents(r.cents))}</td></tr>))}
                <tr><td className="right font-semibold">Total geral</td><td className="right font-semibold">{consolidated.totalQty}</td><td className="right font-semibold">{BRL(fromCents(consolidated.totalCents))}</td></tr>
              </tbody>
            </table>
          </div>
        ):(<p className="report-empty">Sem dados para consolidar.</p>)}
      </section>

      <footer className="report-footer">
        <p>* Equivalências fixas: Obstétrico de rotina → 1× Abdominal total; Morfológico 1º trimestre → 1× Abdominal total + 1× Rins e Vias; Morfológico do 2º trimestre → 1× Abdominal total + 1× Rins e Vias + 1× Transvaginal; Mamas/Mamas e Axilas → 2× Rins e Vias.</p>
        <p className="report-footer-note">Relatório Gerado pelo sistema LILI – Laudos Inteligentes.</p>
      </footer>
    </div>
  </div>);
}
