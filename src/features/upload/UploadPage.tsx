// src/features/upload/UploadPage.tsx
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { parsePtBrNumber, excelSerialToISODate } from '../../utils/normalization';
import * as XLSX from 'xlsx';
import { Dropzone, MIME_TYPES } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import {
  Title, Card, Text, Button, Badge, Loader, Group, Table, rem, Grid, Divider
} from '@mantine/core';
import { IconUpload, IconX, IconFileSpreadsheet } from '@tabler/icons-react';
import { DateInput } from '@mantine/dates';
import { useEmpresaId } from '../../contexts/TenantContext';
import {
  fetchUploadsPorDia,
  setUploadAtivo,
  fetchUltimoDiaComDados,
  fetchEstadoAnterior,
  type VUploadDia
} from '../../services/db';
import {
  fetchFuncionariosMeta,
  fetchFuncionarioCentros,
  upsertFuncionarioMeta,
  addFuncionarioCentro,
  type FuncionarioMeta
  // type FuncionarioCentro removed
} from '../../services/funcionarios';
import LinkResolutionModal, {
  type MatriculaPendente,
  type MatriculaDistribuir,
  type ConfirmedPendente,
  type ConfirmedDistribuicao,
} from './LinkResolutionModal';

/* ==========================
   Tipos Locais
========================== */
type Centro = { id: number; codigo: string; ativo?: boolean | null; desativado_desde?: string | null };

/** Linha final resolvida, sempre com centro_id e matricula preenchidos */
type ParsedRow = {
  data_wip: string;       // 'YYYY-MM-DD'
  centro_id: number;      // sempre resolvido via DB
  aliquota_horas: number;
  matricula: string;      // sempre presente
};

/** Linha bruta extraída do Excel (antes de resolver máquinas) */
type ParsedRowSimple = {
  data_wip: string;
  aliquota_horas: number;
  matricula: string;
  excelRow: number;
};

/** Linha ignorada com motivo */
type IgnoredRow = {
  excelRow: number;
  reason: string;
};

type UploadError = { tipo: 'sheet' | 'header' | 'row' | 'meta' | 'persist'; mensagem: string };

// Dados pendentes entre etapas do upload
type PendingUpload = {
  file: File;
  autoResolvedRows: ParsedRow[];
  ignoredRows: IgnoredRow[];
};

/* ==========================
   Utils
========================== */
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function normKey(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\(\)\[\]\{\},;.:/_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCol(columns: string[], targets: string[]): string | null {
  const rawCols = columns.map((c) => c.trim());
  const normCols = rawCols.map(normKey);
  const normTargets = targets.map(normKey);

  for (const t of normTargets) {
    const idx = normCols.findIndex((c) => c === t);
    if (idx >= 0) return rawCols[idx];
  }
  for (const t of normTargets) {
    const rx = new RegExp(`(?:^|\\s)${t}(?:\\s|$)`);
    const idx = normCols.findIndex((c) => rx.test(c));
    if (idx >= 0) return rawCols[idx];
  }
  return null;
}

function groupByDate<T extends { data_wip: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const arr = map.get(r.data_wip) ?? [];
    arr.push(r);
    map.set(r.data_wip, arr);
  }
  return map;
}

function parseWipISO(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === 'number') return excelSerialToISODate(input);
  let s = String(input).trim();
  let m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseLocalDateString(input: string | null | undefined): Date | null {
  if (!input) return null;
  let s = input!.trim();
  const t = s.indexOf('T');
  if (t >= 0) s = s.slice(0, t);
  let m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

/* ==========================
   Página Principal
========================== */
export default function UploadPage() {
  const empresaId = useEmpresaId();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [dia, setDia] = useState<Date | null>(null);
  const [uploadsDia, setUploadsDia] = useState<VUploadDia[]>([]);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const nav = useNavigate();

  // --- Estados do fluxo de upload ---
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [modalPendentes, setModalPendentes] = useState<MatriculaPendente[]>([]);
  const [modalDistribuicoes, setModalDistribuicoes] = useState<MatriculaDistribuir[]>([]);
  const [ignoredRows, setIgnoredRows] = useState<IgnoredRow[]>([]);

  const pushLog = (s: string) => setLog((prev) => [...prev, s]);

  const dateToISO = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const toLocalBR = (dt: string | Date) => {
    const d = new Date(dt);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  };

  const refetchUploads = useCallback(async (d: Date) => {
    setLoadingUploads(true);
    setUploadsDia([]);
    try {
      const iso = dateToISO(d);
      const rows = await fetchUploadsPorDia(empresaId, iso);
      setUploadsDia(rows);
    } finally {
      setLoadingUploads(false);
    }
  }, [empresaId]);

  const handleDiaChange = (value: unknown) => {
    if (!value) {
      setDia(null);
      setUploadsDia([]);
      setLoadingUploads(false);
      return;
    }
    let d: Date | null = null;
    if (value instanceof Date) d = value;
    else if (typeof value === 'string') d = parseLocalDateString(value);
    else if ((value as any)?.toDate instanceof Function) d = (value as any).toDate();

    if (!d || Number.isNaN(d.getTime())) return;
    const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    setDia(normalized);
    refetchUploads(normalized);
  };

  const uploadsCount = uploadsDia.length;
  const totalHorasDia = useMemo(
    () => uploadsDia.reduce((acc, u) => acc + Number(u.horas_total || 0), 0),
    [uploadsDia]
  );

  useEffect(() => {
    (async () => {
      if (dia) return;
      try {
        const last = await fetchUltimoDiaComDados(empresaId);
        const target = last
          ? new Date(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10))
          : new Date();
        setDia(target);
        await refetchUploads(target);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [dia, refetchUploads, empresaId]);

  /* ==========================
     IO/DB helpers
  ========================== */
  const readWorkbook = async (file: File) => {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: 'array' });
  };

  const fetchSupabaseCentros = async (): Promise<Centro[]> => {
    const { data, error } = await supabase.from('centros').select('id, codigo, ativo, desativado_desde').eq('empresa_id', empresaId);
    if (error) throw error;
    return data ?? [];
  };

  const isAtivoNoDia = (c: Centro, dataISO: string) => {
    const flagAtivo = c.ativo ?? true;
    const corte = c.desativado_desde ?? null;
    return flagAtivo && (!corte || dataISO < corte);
  };

  /** Carrega centros ativos da empresa e devolve map por id + lista plana */
  const carregarCentros = async () => {
    const centros = await fetchSupabaseCentros();
    const centrosById = new Map<number, Centro>();
    for (const c of centros) centrosById.set(c.id, c);
    return { centrosById, centros };
  };

  const carregarTotaisDoDiaCount = async (dataISO: string) => {
    const { count, error } = await supabase
      .from('totais_diarios')
      .select('centro_id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('data_wip', dataISO);
    if (error) throw error;
    return count ?? 0;
  };

  /* =========================================================================
     LÓGICA PRINCIPAL DE PERSISTÊNCIA (COM DETECÇÃO DE DADOS ESTAGNADOS)
     =========================================================================
  */
  const salvarTotais = async (rows: ParsedRow[], uploadId: number, dataISO: string) => {
    if (!rows.length) return;

    // 1. Busca o estado anterior (último upload ativo deste dia)
    const estadoAnterior = await fetchEstadoAnterior(empresaId, dataISO);

    // Data de referência padrão ("agora"), caso o dado seja novo ou tenha mudado
    const agoraRef = new Date().toISOString();

    // ---- A. Centros (totais_diarios) com Lógica de High Water Mark ----

    // Agregação em memória
    const agg = new Map<string, {
      data_wip: string;
      centro_id: number;
      horas_somadas: number;
    }>();

    for (const r of rows) {
      // centro_id e matricula são sempre preenchidos nesta etapa
      const key = `${r.data_wip}|${r.centro_id}`;
      const cur = agg.get(key) ?? {
        data_wip: r.data_wip,
        centro_id: r.centro_id,
        horas_somadas: 0,
      };
      cur.horas_somadas += r.aliquota_horas;
      agg.set(key, cur);
    }

    // Prepara inserts comparando com o anterior
    const inserts = [...agg.values()].map((x) => {
      const anterior = estadoAnterior.get(x.centro_id);
      let refFinal = agoraRef;

      // Se existia dado anterior para esta máquina no mesmo dia
      if (anterior) {
        // Verifica se houve mudança nas horas (com tolerância para float)
        const diff = Math.abs(x.horas_somadas - anterior.horas);
        const mudou = diff > 0.005;

        if (!mudou) {
          // Se não mudou, mantemos a data de referência antiga ("foto do passado")
          refFinal = anterior.ref || agoraRef;
        }
        // Se mudou, refFinal continua sendo 'agoraRef'
      }

      return {
        data_wip: x.data_wip,
        centro_id: x.centro_id,
        horas_somadas: +x.horas_somadas.toFixed(4),
        upload_id_origem: uploadId,
        data_referencia: refFinal,
        empresa_id: empresaId
      };
    });

    // Remove registros antigos deste upload (caso de reprocessamento) e insere novos
    await supabase.from('totais_diarios').delete().eq('upload_id_origem', uploadId);

    // Inserção em Batch
    const { error: insErr } = await supabase.from('totais_diarios').insert(inserts);
    if (insErr) throw insErr;


    // ---- B. Funcionários (totais_func_diarios) - Mantém lógica padrão ----
    const aggFunc = new Map<string, {
      data_wip: string; centro_id: number; matricula: string; horas_somadas: number
    }>();

    for (const r of rows) {
      const key = `${r.data_wip}|${r.centro_id}|${r.matricula}`;
      const cur = aggFunc.get(key) ?? {
        data_wip: r.data_wip,
        centro_id: r.centro_id,
        matricula: r.matricula,
        horas_somadas: 0,
      };
      cur.horas_somadas += r.aliquota_horas;
      aggFunc.set(key, cur);
    }

    await supabase.from('totais_func_diarios').delete().eq('upload_id_origem', uploadId);

    if (aggFunc.size) {
      const insertsFunc = [...aggFunc.values()].map((x) => ({
        data_wip: x.data_wip,
        centro_id: x.centro_id,
        matricula: x.matricula,
        horas_somadas: +x.horas_somadas.toFixed(4),
        upload_id_origem: uploadId,
        empresa_id: empresaId
      }));
      const { error: eFunc } = await supabase.from('totais_func_diarios').insert(insertsFunc);
      if (eFunc) throw eFunc;
    }
  };

  const marcarUpload = async (uploadId: number, dataISO: string) => {
    await setUploadAtivo(dataISO, uploadId);
  };

  const persistirUpload = async (
    dataISO: string,
    nomeArquivo: string,
    originalRows: ParsedRow[],
  ): Promise<number> => {
    const payload: any = {
      data_wip: dataISO,
      nome_arquivo: nomeArquivo,
      linhas: originalRows.length,
      horas_total: originalRows.reduce((acc, curr) => acc + curr.aliquota_horas, 0),
      empresa_id: empresaId
    };

    const { data, error } = await supabase
      .from('uploads')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    return data!.id as number;
  };

  /* ==========================
     Normalização das linhas
     Lê apenas matrícula + alíquota + data; ignora coluna de máquina.
  ========================== */
  const normalizarLinhas = async (sheetRows: any[]) => {
    const headers = Object.keys(sheetRows[0] ?? {}).map((k) => k.trim());

    const colData = detectCol(headers, ['data', 'data wip', 'wip', 'data do wip', 'mes', 'mês']);
    const colAliquota = detectCol(headers, [
      'aliquota', 'alíquota', 'aliquota h', 'alíquota h',
      'aliquota horas', 'alíquota horas',
      'total horas', 'horas totais', 'qtd horas', 'quantidade de horas', 'total h'
    ]);
    const colFuncionario = detectCol(headers, ['funcionario', 'funcionário', 'matricula', 'matrícula', 'colaborador']);

    if (!colData || !colAliquota || !colFuncionario) {
      const missing = [
        !colData ? 'Data WIP' : null,
        !colAliquota ? 'Alíquota/Horas' : null,
        !colFuncionario ? 'Matrícula/Funcionário' : null,
      ].filter(Boolean).join(', ');
      throw { tipo: 'header', mensagem: `Colunas obrigatórias ausentes: ${missing}.` } as UploadError;
    }

    const simpleRows: ParsedRowSimple[] = [];
    const ignoradas: IgnoredRow[] = [];

    for (let idx = 0; idx < sheetRows.length; idx += 1) {
      const raw = sheetRows[idx];
      const excelRow = idx + 2;

      // Pula linhas totalmente vazias
      const soVazios = Object.values(raw).every((v) => v == null || String(v).trim() === '');
      if (soVazios) continue;

      // Pula linhas de totais (ex: rodapé da planilha)
      const linhaTexto = Object.values(raw).map((v) => String(v ?? '').toLowerCase()).join(' ');

      const dataWip = parseWipISO(raw[colData]);
      if (!dataWip) {
        if (linhaTexto.includes('total')) continue;
        ignoradas.push({ excelRow, reason: `Data WIP inválida "${raw[colData]}"` });
        continue;
      }

      const rawF = String(raw[colFuncionario] ?? '').trim();
      const onlyDigits = (rawF.match(/\d+/)?.[0] ?? '').slice(0, 8);
      const matricula = onlyDigits && onlyDigits.length >= 1 ? onlyDigits : null;
      if (!matricula) {
        ignoradas.push({ excelRow, reason: `Matrícula inválida ou ausente "${raw[colFuncionario]}"` });
        continue;
      }

      const aliParsed = parsePtBrNumber(raw[colAliquota]);
      if (!isFiniteNumber(aliParsed) || aliParsed <= 0) {
        ignoradas.push({ excelRow, reason: `Alíquota inválida ou zero "${raw[colAliquota]}"` });
        continue;
      }

      simpleRows.push({
        data_wip: dataWip,
        aliquota_horas: +aliParsed.toFixed(4),
        matricula,
        excelRow,
      });
    }

    return { simpleRows, ignoradas };
  };

  /* ==========================
     onDrop - FLUXO PRINCIPAL
  ========================== */
  const onDrop = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setLog([]);

    try {
      const file = files[0];
      pushLog(`Lendo arquivo "${file.name}"...`);
      const wb = await readWorkbook(file);

      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw { tipo: 'sheet', mensagem: 'Nenhuma planilha encontrada no arquivo.' } as UploadError;

      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: null });
      if (!json.length) throw { tipo: 'sheet', mensagem: 'Planilha vazia.' } as UploadError;

      pushLog('Normalizando linhas (coluna de máquina ignorada — resolvendo via vínculos)...');
      const { simpleRows, ignoradas } = await normalizarLinhas(json);

      if (ignoradas.length) {
        pushLog(`Linhas ignoradas: ${ignoradas.length}`);
        ignoradas.forEach(r => pushLog(`  Linha ${r.excelRow}: ${r.reason}`));
      }
      setIgnoredRows(ignoradas);

      if (!simpleRows.length) throw { tipo: 'row', mensagem: 'Nenhuma linha válida após normalização (verifique colunas de Data, Alíquota e Matrícula).' } as UploadError;

      // ==========================================================
      // NOVA LÓGICA: Resolver máquinas 100% via vínculos no banco
      // ==========================================================
      pushLog('Carregando centros e vínculos de funcionários...');
      const [{ centrosById, centros }, metas, vinculos] = await Promise.all([
        carregarCentros(),
        fetchFuncionariosMeta(empresaId),
        fetchFuncionarioCentros(empresaId),
      ]);

      const centrosList = centros.map(c => ({ id: c.id, codigo: c.codigo }));

      const metaByMatricula = new Map<string, FuncionarioMeta>();
      metas.forEach(m => metaByMatricula.set(m.matricula, m));

      // funcionario_meta_id → [centro_ids]
      const linksByMetaId = new Map<number, number[]>();
      for (const v of vinculos) {
        const arr = linksByMetaId.get(v.funcionario_meta_id) ?? [];
        arr.push(v.centro_id);
        linksByMetaId.set(v.funcionario_meta_id, arr);
      }

      // Agrega horas por (matricula, data_wip)
      const aggMap = new Map<string, { matricula: string; data_wip: string; totalHoras: number }>();
      for (const r of simpleRows) {
        const key = `${r.matricula}|${r.data_wip}`;
        const cur = aggMap.get(key) ?? { matricula: r.matricula, data_wip: r.data_wip, totalHoras: 0 };
        cur.totalHoras += r.aliquota_horas;
        aggMap.set(key, cur);
      }

      const datas = [...new Set(simpleRows.map(r => r.data_wip))];
      pushLog(`Detectadas ${datas.length} data(s): ${datas.join(', ')}`);
      pushLog(`Matrículas únicas: ${aggMap.size}`);

      // Classifica cada (matricula, data_wip)
      const autoResolvedRows: ParsedRow[] = [];
      const pendentes: MatriculaPendente[] = [];
      const paraDistribuir: MatriculaDistribuir[] = [];

      for (const { matricula, data_wip, totalHoras } of aggMap.values()) {
        const meta = metaByMatricula.get(matricula);

        if (!meta) {
          // Caso A: matrícula inexistente → cadastrar + selecionar máquinas
          pushLog(`  [A] ${matricula} (${data_wip}): matrícula não encontrada no banco → cadastrar`);
          pendentes.push({ matricula, nome: '', data_wip, totalHoras: +totalHoras.toFixed(4), mustCreateUser: true, availableCentros: centrosList });
          continue;
        }

        const allLinkedIds = linksByMetaId.get(meta.id) ?? [];
        // Filtra apenas centros ativos no dia
        const activeIds = allLinkedIds.filter(id => {
          const c = centrosById.get(id);
          return c ? isAtivoNoDia(c, data_wip) : false;
        });

        const allCodes = allLinkedIds.map(id => centrosById.get(id)?.codigo ?? `ID ${id}`);
        const activeCodes = activeIds.map(id => centrosById.get(id)?.codigo ?? `ID ${id}`);

        if (activeIds.length === 0) {
          // Caso B: existe mas sem vínculo ativo → selecionar máquinas
          const detail = allLinkedIds.length === 0
            ? 'sem vínculos cadastrados'
            : `vínculos [${allCodes.join(', ')}] inativos na data`;
          pushLog(`  [B] ${matricula} (${data_wip}): ${detail} → selecionar máquina`);
          pendentes.push({ matricula, nome: meta.nome, data_wip, totalHoras: +totalHoras.toFixed(4), mustCreateUser: false, availableCentros: centrosList });
        } else if (activeIds.length === 1) {
          // Caso C: 1 máquina ativa → auto-resolve
          pushLog(`  [C] ${matricula} (${data_wip}): auto-resolvido → ${activeCodes[0]}`);
          autoResolvedRows.push({ data_wip, centro_id: activeIds[0], aliquota_horas: +totalHoras.toFixed(4), matricula });
        } else {
          // Caso D: múltiplas máquinas → distribuição manual
          pushLog(`  [D] ${matricula} (${data_wip}): ${activeIds.length} máquinas ativas [${activeCodes.join(', ')}] → distribuir`);
          paraDistribuir.push({
            matricula, nome: meta.nome, data_wip, totalHoras: +totalHoras.toFixed(4),
            machineIds: activeIds,
            machineCodes: activeCodes,
          });
        }
      }

      pushLog(`Auto-resolvidas: ${autoResolvedRows.length} · Para cadastrar/vincular: ${pendentes.length} · Para distribuir: ${paraDistribuir.length}`);

      if (pendentes.length > 0 || paraDistribuir.length > 0) {
        pushLog('⚠️ Aguardando resolução pelo operador...');
        setPendingUpload({ file, autoResolvedRows, ignoredRows: ignoradas });
        setModalPendentes(pendentes);
        setModalDistribuicoes(paraDistribuir);
        setShowLinkModal(true);
        setBusy(false);
        return;
      }

      // Tudo resolvido automaticamente
      await etapa3Persistir(file, autoResolvedRows, groupByDate(autoResolvedRows));

    } catch (err: any) {
      console.error(err);
      const tipo = (err?.tipo as UploadError['tipo']) ?? 'persist';
      const mensagem = err?.mensagem ?? err?.message ?? 'Erro desconhecido ao processar o upload.';
      pushLog(`Erro (${tipo}): ${mensagem}`);
      notifications.show({ title: 'Falha no upload', message: mensagem, color: 'red' });
      setBusy(false);
    }
  }, [dia, refetchUploads, empresaId]);


  /* ==========================
     Callback do modal de resolução
  ========================== */
  const handleLinkResolutionConfirm = async (
    confirmedPendentes: ConfirmedPendente[],
    confirmedDistribuicoes: ConfirmedDistribuicao[]
  ) => {
    setShowLinkModal(false);
    setBusy(true);

    try {
      const novos = confirmedPendentes.filter(p => p.isNewUser);
      const vincular = confirmedPendentes.filter(p => !p.isNewUser);
      pushLog(`Cadastrando ${novos.length} novo(s) funcionário(s) e ${vincular.length} vínculo(s)...`);

      // 1. Criar usuários novos
      for (const cp of novos) {
        await upsertFuncionarioMeta(empresaId, {
          matricula: cp.matricula,
          nome: cp.nome,
          meta_diaria_horas: 0,
          turno: cp.turno,
        });
        const metasAtual = await fetchFuncionariosMeta(empresaId);
        const func = metasAtual.find(f => f.matricula === cp.matricula);
        if (func) {
          for (const { centroId } of cp.centroHoras) {
            await addFuncionarioCentro(empresaId, func.id, centroId).catch(() => {});
          }
        }
      }

      // 2. Vincular máquinas para usuários existentes sem vínculo
      if (vincular.length > 0) {
        const metasAtual = await fetchFuncionariosMeta(empresaId);
        for (const cp of vincular) {
          const func = metasAtual.find(f => f.matricula === cp.matricula);
          if (func) {
            for (const { centroId } of cp.centroHoras) {
              await addFuncionarioCentro(empresaId, func.id, centroId).catch(() => {});
            }
          }
        }
      }

      pushLog('Vínculos atualizados.');

      // 3. Montar linhas finais: auto-resolvidas + modal
      const finalRows: ParsedRow[] = [...(pendingUpload?.autoResolvedRows ?? [])];

      for (const cp of confirmedPendentes) {
        for (const { centroId, horas } of cp.centroHoras) {
          if (horas > 0) finalRows.push({ data_wip: cp.data_wip, centro_id: centroId, aliquota_horas: +horas.toFixed(4), matricula: cp.matricula });
        }
      }
      for (const cd of confirmedDistribuicoes) {
        for (const { centroId, horas } of cd.centroHoras) {
          if (horas > 0) finalRows.push({ data_wip: cd.data_wip, centro_id: centroId, aliquota_horas: +horas.toFixed(4), matricula: cd.matricula });
        }
      }

      if (!pendingUpload || !finalRows.length) {
        pushLog('Nenhuma linha para persistir.');
        setBusy(false);
        return;
      }

      await etapa3Persistir(pendingUpload.file, finalRows, groupByDate(finalRows));

    } catch (err: any) {
      console.error(err);
      const mensagem = err?.message || 'Erro ao processar vínculos.';
      pushLog(`Erro: ${mensagem}`);
      notifications.show({ title: 'Erro', message: mensagem, color: 'red' });
      setBusy(false);
    }
  };


  /* ==========================
     ETAPA 3: Persistir
  ========================== */
  const etapa3Persistir = async (
    file: File,
    _rows: ParsedRow[], // não usamos diretamente _rows pois usamos os grupos
    groups: Map<string, ParsedRow[]>
  ) => {
    setBusy(true);
    try {
      for (const [dataISO, rowsDia] of groups.entries()) {
        pushLog(`\n=== Dia ${dataISO} ===`);
        try {
          const existentes = await carregarTotaisDoDiaCount(dataISO);
          if (existentes) pushLog(`Encontradas ${existentes} linhas já cadastradas para ${dataISO} (serão substituídas).`);

          pushLog('Persistindo upload...');
          const uploadId = await persistirUpload(dataISO, file.name, rowsDia);
          pushLog(`Upload ${uploadId} criado para ${dataISO}.`);

          pushLog('Calculando totais (verificando estagnação de dados)...');
          await salvarTotais(rowsDia, uploadId, dataISO);
          pushLog('Totais salvos.');

          pushLog('Marcando upload como ativo...');
          await marcarUpload(uploadId, dataISO);
          pushLog('Upload marcado como ATIVO.');

          if (dia && dateToISO(dia) === dataISO) {
            await refetchUploads(dia);
          }
        } catch (e: any) {
          console.error(e);
          pushLog(`Erro ao processar ${dataISO}: ${e?.mensagem ?? e?.message ?? e}`);
        }
      }

      notifications.show({
        title: 'Upload processado',
        message: `Arquivo "${file.name}" importado. (${groups.size} dia(s))`,
        color: 'green',
      });

      if (dia) await refetchUploads(dia);

    } catch (err: any) {
      console.error(err);
      const mensagem = err?.mensagem ?? err?.message ?? 'Erro desconhecido ao processar o upload.';
      pushLog(`Erro: ${mensagem}`);
      notifications.show({ title: 'Falha no upload', message: mensagem, color: 'red' });
    } finally {
      setBusy(false);
      setPendingUpload(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <Title order={2} mb="sm">Metas - Upload</Title>
      <Text c="dimmed" mb="lg">
        Envie o .xlsx. O sistema lê a <b>matrícula</b> e consulta as máquinas vinculadas no banco —
        a coluna de máquina da planilha é ignorada. Se uma matrícula tiver múltiplas máquinas ou não
        estiver cadastrada, será solicitada a distribuição manual antes de salvar.
        <br />Se as horas de uma máquina não mudaram em relação ao upload anterior, a <b>referência de tempo</b> é mantida (badge laranja na TV).
      </Text>

      <Grid gutter="lg">
        <Grid.Col span={12}>
          <Card withBorder shadow="sm" radius="lg" p="lg">
            <Dropzone
              onDrop={onDrop}
              onReject={() => notifications.show({ title: 'Arquivo inválido', message: 'Selecione um arquivo Excel (.xlsx, .xls)', color: 'red' })}
              maxSize={50 * 1024 * 1024}
              accept={[
                MIME_TYPES.xlsx,
                MIME_TYPES.xls,
                'application/vnd.ms-excel.sheet.macroEnabled.12',
                'application/octet-stream',
              ]}
              loading={busy}
              multiple={false}
            >
              <div style={{ padding: '48px 12px', textAlign: 'center' }}>
                {busy ? (
                  <Group justify="center">
                    <Loader size="md" />
                    <Text>Processando arquivo...</Text>
                  </Group>
                ) : (
                  <Group justify="center" gap="xl" style={{ minHeight: 120, pointerEvents: 'none' }}>
                    <Dropzone.Accept>
                      <IconUpload
                        style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-blue-6)' }}
                        stroke={1.5}
                      />
                    </Dropzone.Accept>
                    <Dropzone.Reject>
                      <IconX
                        style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-red-6)' }}
                        stroke={1.5}
                      />
                    </Dropzone.Reject>
                    <Dropzone.Idle>
                      <IconFileSpreadsheet
                        style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-dimmed)' }}
                        stroke={1.5}
                      />
                    </Dropzone.Idle>

                    <div>
                      <Text size="xl" inline>
                        Arraste o arquivo aqui ou clique para selecionar
                      </Text>
                      <div style={{ color: '#667085', fontSize: 14 }}>Formatos: .xlsx / .xls • Máx. 50 MB</div>
                    </div>
                  </Group>
                )}
              </div>
            </Dropzone>
          </Card>
        </Grid.Col>

        <Grid.Col span={12}>
          <Card withBorder shadow="sm" radius="lg" p="lg">
            <Group justify="space-between" align="center" mb="sm" wrap="wrap">
              <Group gap="xs" align="center">
                <Title order={4} m={0}>Uploads do dia</Title>
                <Badge variant="light">{uploadsCount} arquivo(s)</Badge>
                <Badge variant="dot">Total: {totalHorasDia.toFixed(2)} h</Badge>
              </Group>

              <DateInput
                value={dia}
                onChange={handleDiaChange}
                valueFormat="DD/MM/YYYY"
                locale="pt-BR"
                placeholder="DD/MM/AAAA"
                dateParser={(input) => {
                  if (!input) return null;
                  const d = new Date(input);
                  return isNaN(d.getTime()) ? new Date() : d;
                }}
                size="sm"
                styles={{
                  input: { minWidth: 132, textAlign: 'center' },
                  root: { marginLeft: 'auto' },
                }}
                maxDate={new Date()}
                clearable
              />
            </Group>

            <Divider my="sm" />

            <Table highlightOnHover withTableBorder stickyHeader striped verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: '45%' }}>Arquivo</Table.Th>
                  <Table.Th>Enviado em</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Linhas</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Horas totais</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th style={{ width: 160 }} />
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {loadingUploads ? (
                  <Table.Tr><Table.Td colSpan={6}>Carregando…</Table.Td></Table.Tr>
                ) : uploadsDia.length === 0 ? (
                  <Table.Tr><Table.Td colSpan={6}>Nenhum upload encontrado para esta data.</Table.Td></Table.Tr>
                ) : (
                  uploadsDia.map((u) => {
                    const enviado = toLocalBR(u.enviado_em);
                    const ativo = Boolean(u.ativo);

                    return (
                      <Table.Tr
                        key={`${u.data_wip}-${u.upload_id}`}
                        style={{
                          cursor: 'pointer',
                          background: ativo ? 'var(--mantine-color-green-0)' : undefined,
                        }}
                        onClick={() => nav(`/upload/${u.data_wip}/${u.upload_id}`)}
                      >
                        <Table.Td
                          title={u.nome_arquivo}
                          style={{
                            maxWidth: 520,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {u.nome_arquivo}
                        </Table.Td>

                        <Table.Td>{enviado}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{u.linhas}</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{Number(u.horas_total).toFixed(2)} h</Table.Td>

                        <Table.Td>
                          {ativo
                            ? <Badge color="green" radius="sm">ATIVO</Badge>
                            : <Badge color="gray" variant="light" radius="sm">Inativo</Badge>}
                        </Table.Td>

                        <Table.Td>
                          {!ativo && (
                            <Button
                              size="xs"
                              variant="light"
                              fullWidth
                              onClick={async (event) => {
                                event.stopPropagation();
                                if (!dia) return;
                                setLoadingUploads(true);
                                try {
                                  const iso = dateToISO(dia);
                                  await setUploadAtivo(iso, u.upload_id);
                                  await refetchUploads(dia);
                                } catch (e) {
                                  console.error(e);
                                } finally {
                                  setLoadingUploads(false);
                                }
                              }}
                            >
                              Tornar ativo
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Card>
        </Grid.Col>

      {/* Linhas Ignoradas */}
        {ignoredRows.length > 0 && (
          <Grid.Col span={12}>
            <Card withBorder shadow="sm" radius="lg" p="md">
              <Group justify="space-between" mb="xs">
                <Title order={6} style={{ opacity: 0.9, letterSpacing: 0.3 }}>
                  Linhas Ignoradas no Último Upload
                </Title>
                <Badge color="orange" variant="light">{ignoredRows.length} linha{ignoredRows.length !== 1 ? 's' : ''}</Badge>
              </Group>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {ignoredRows.map((r) => (
                  <Text key={r.excelRow} size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                    Linha {r.excelRow}: {r.reason}
                  </Text>
                ))}
              </div>
            </Card>
          </Grid.Col>
        )}

        <Grid.Col span={12}>
          <Card withBorder shadow="sm" radius="lg" p="md">
            <Title order={6} style={{ opacity: 0.9, letterSpacing: 0.3 }} mb="xs">Log</Title>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#101828', margin: 0, fontSize: 13, fontFamily: 'monospace' }}>
                {log.join('\n') || 'Nenhum evento ainda.'}
              </pre>
            </div>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Modal de resolução de vínculos / distribuição de horas */}
      <LinkResolutionModal
        opened={showLinkModal}
        onClose={() => {
          setShowLinkModal(false);
          setPendingUpload(null);
          pushLog('Upload cancelado pelo usuário.');
        }}
        onConfirm={handleLinkResolutionConfirm}
        pendentes={modalPendentes}
        paraDistribuir={modalDistribuicoes}
      />

    </div>
  );
}