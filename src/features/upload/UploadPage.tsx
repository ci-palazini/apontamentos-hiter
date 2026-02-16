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
import LinkResolutionModal, { type MissingUser, type MissingLink } from './LinkResolutionModal';

/* ==========================
   Tipos Locais
========================== */
type Centro = { id: number; codigo: string; ativo?: boolean | null; desativado_desde?: string | null };
type Alias = { alias_texto: string; centro_id: number };

type ParsedRow = {
  data_wip: string;        // 'YYYY-MM-DD'
  categoria_raw: string;
  centro_id: number;
  aliquota_horas: number;
  tipo_raw?: string | null;
  matricula: string;       // AGORA OBRIGATÓRIO
};

type UploadError = { tipo: 'sheet' | 'header' | 'row' | 'meta' | 'persist'; mensagem: string };

// Dados pendentes entre etapas do upload
type PendingUpload = {
  file: File;
  rows: ParsedRow[];
  groups: Map<string, ParsedRow[]>;
  mapping: { centrosById: Map<number, Centro>; aliasIndex: Map<string, number> };
  avisos: string[];
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

function keyize(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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

  // --- Estados dos modais de pré-processamento ---
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);

  // Modal 1: Resolução de Vínculos (Substitui Registration e Reallocation)
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [missingUsers, setMissingUsers] = useState<MissingUser[]>([]);
  const [missingLinks, setMissingLinks] = useState<MissingLink[]>([]);

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

  const fetchAlias = async (): Promise<Alias[]> => {
    const { data, error } = await supabase.from('centro_aliases').select('alias_texto, centro_id');
    if (error) throw error;
    return data ?? [];
  };

  const isAtivoNoDia = (c: Centro, dataISO: string) => {
    const flagAtivo = c.ativo ?? true;
    const corte = c.desativado_desde ?? null;
    return flagAtivo && (!corte || dataISO < corte);
  };

  const carregarMapeamento = async () => {
    const centros = await fetchSupabaseCentros();
    const aliases = await fetchAlias();

    const centrosById = new Map<number, Centro>();
    for (const c of centros) centrosById.set(c.id, c);

    const aliasIndex = new Map<string, number>();
    for (const a of aliases) {
      const k1 = keyize(a.alias_texto);
      const k2 = k1.replace(/^ce/, '');
      aliasIndex.set(k1, a.centro_id);
      aliasIndex.set(k2, a.centro_id);
    }
    return { centrosById, aliasIndex };
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
      // IMPORTANTE: Agora só consideramos linhas com matrícula válida e vinculada!
      // (Isso já foi garantido na validação anterior)
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
      // Como matricula agora é obrigatória, não precisamos checar se existe
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
  ========================== */
  const normalizarLinhas = async (
    sheetRows: any[],
    mapping: { centrosById: Map<number, Centro>; aliasIndex: Map<string, number> },
  ) => {
    const headers = Object.keys(sheetRows[0] ?? {}).map((k) => k.trim());

    const colData = detectCol(headers, ['data', 'data wip', 'wip', 'data do wip', 'mes', 'mês']);
    const colCategoria = detectCol(headers, ['categoria', 'centro', 'grupo', 'maquina', 'máquina', 'equipamento']);
    const colAliquota = detectCol(headers, [
      'aliquota', 'alíquota', 'aliquota h', 'alíquota h',
      'aliquota horas', 'alíquota horas',
      'total horas', 'horas totais', 'qtd horas', 'quantidade de horas', 'total h'
    ]);
    const colTipo = detectCol(headers, ['tipo', 'origem']);
    const colFuncionario = detectCol(headers, ['funcionario', 'funcionário', 'matricula', 'matrícula', 'colaborador']);

    if (!colData || !colCategoria || !colAliquota || !colFuncionario) {
      const missing = [
        !colData ? 'Data WIP' : null,
        !colCategoria ? 'Categoria' : null,
        !colAliquota ? 'Alíquota' : null,
        !colFuncionario ? 'Matrícula/Funcionário' : null,
      ].filter(Boolean).join(', ');
      throw { tipo: 'header', mensagem: `Colunas obrigatórias ausentes: ${missing}.` } as UploadError;
    }

    const rows: ParsedRow[] = [];
    const erros: UploadError[] = [];
    const avisos: string[] = [];

    for (let idx = 0; idx < sheetRows.length; idx += 1) {
      const raw = sheetRows[idx];
      const excelRow = idx + 2;

      const dataWip = parseWipISO(raw[colData]);
      if (!dataWip) {
        // ... (ignorando linhas de total/vazias como antes)
        const linhaTexto = Object.values(raw).map((v) => String(v ?? '').toLowerCase()).join(' ');
        if (linhaTexto.includes('total')) continue;
        const soVazios = Object.values(raw).every((v) => {
          if (v == null) return true;
          const s = String(v).trim();
          return s === '';
        });
        if (soVazios) continue;
        erros.push({ tipo: 'row', mensagem: `Linha ${excelRow}: Data WIP inválida (${raw[colData]}).` });
        continue;
      }

      const categoriaRaw = String(raw[colCategoria] ?? '').trim();
      if (!categoriaRaw) {
        erros.push({ tipo: 'row', mensagem: `Linha ${excelRow}: Categoria vazia.` });
        continue;
      }

      const k1 = keyize(categoriaRaw);
      const k2 = k1.replace(/^ce/, '');
      const centroId = mapping.aliasIndex.get(k1) ?? mapping.aliasIndex.get(k2) ?? null;

      if (centroId == null) {
        // Se não achou centro, ignora (ou avisa)
        continue;
      }

      const centro = mapping.centrosById.get(centroId);
      if (!centro) continue;
      if (!isAtivoNoDia(centro, dataWip)) continue;

      const aliParsed = parsePtBrNumber(raw[colAliquota]);
      if (!isFiniteNumber(aliParsed)) {
        erros.push({ tipo: 'row', mensagem: `Linha ${excelRow}: Alíquota inválida (${raw[colAliquota]}).` });
        continue;
      }
      const aliquota = +aliParsed.toFixed(4);
      const tipoRaw = colTipo ? (String(raw[colTipo] ?? '').trim() || null) : null;

      // --- VALIDAÇÃO DA MATRÍCULA ---
      const rawF = String(raw[colFuncionario] ?? '').trim();
      const onlyDigits = (rawF.match(/\d+/)?.[0] ?? '').slice(0, 8);
      const matricula = onlyDigits && onlyDigits.length >= 3 ? onlyDigits : null;

      if (!matricula) {
        erros.push({ type: 'row', mensagem: `Linha ${excelRow}: Matrícula inválida ou ausente.` } as any);
        continue;
      }

      rows.push({
        data_wip: dataWip,
        categoria_raw: categoriaRaw,
        centro_id: centro.id,
        aliquota_horas: aliquota,
        tipo_raw: tipoRaw,
        matricula,
      });
    }

    if (erros.length) {
      const mensagem = erros.map((e) => e.mensagem).join('\n');
      throw { tipo: 'row', mensagem } as UploadError;
    }

    return { rows, avisos };
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

      pushLog('Carregando mapeamentos de centros...');
      const mapping = await carregarMapeamento();

      pushLog('Normalizando linhas (Matrículas Obrigatórias)...');
      const { rows, avisos } = await normalizarLinhas(json, mapping);
      if (avisos.length) avisos.forEach((m) => pushLog(`Aviso: ${m}`));
      if (!rows.length) throw { tipo: 'row', mensagem: 'Nenhuma linha válida após normalização.' } as UploadError;

      const groups = groupByDate(rows);
      pushLog(`Detectadas ${groups.size} data(s): ${[...groups.keys()].join(', ')}`);

      // ===============================================
      // NOVA VALIDAÇÃO DE VÍNCULOS
      // ===============================================
      pushLog('Validando vínculos Matrícula ↔ Máquina...');

      // 1. Coletar pares únicos (matricula, centro_id) do arquivo
      const paresNoArquivo = new Map<string, Set<number>>();
      rows.forEach(r => {
        const s = paresNoArquivo.get(r.matricula) ?? new Set();
        s.add(r.centro_id);
        paresNoArquivo.set(r.matricula, s);
      });

      // 2. Fetch dados existentes
      const [metas, vinculos] = await Promise.all([
        fetchFuncionariosMeta(empresaId),
        fetchFuncionarioCentros(empresaId),
      ]);

      const metaByMatricula = new Map<string, FuncionarioMeta>();
      metas.forEach(m => metaByMatricula.set(m.matricula, m));

      // Mapa: Matricula -> Set de CentroIDs vinculados
      const existingLinks = new Map<string, Set<number>>();
      vinculos.forEach(v => {
        const m = metas.find(meta => meta.id === v.funcionario_meta_id);
        if (m) {
          const s = existingLinks.get(m.matricula) ?? new Set();
          s.add(v.centro_id);
          existingLinks.set(m.matricula, s);
        }
      });

      const mUsers: MissingUser[] = [];
      const mLinks: MissingLink[] = [];

      // 3. Verificar cada par do arquivo
      for (const [matricula, centroIds] of paresNoArquivo.entries()) {
        const userExists = metaByMatricula.has(matricula);

        if (!userExists) {
          // Usuário inexistente -> Vai ser criado e já vinculado a TODAS as máquinas que apareceram pra ele
          mUsers.push({
            matricula,
            nome: '', // será preenchido
            machineIds: [...centroIds],
            machineCodes: [...centroIds].map(id => mapping.centrosById.get(id)?.codigo || `ID ${id}`)
          });
        } else {
          // Usuário existe -> Checar se tem vinculo
          const linkedIds = existingLinks.get(matricula) ?? new Set();
          const missingForThisUser: number[] = [];

          centroIds.forEach(cid => {
            if (!linkedIds.has(cid)) {
              missingForThisUser.push(cid);
            }
          });

          if (missingForThisUser.length > 0) {
            mLinks.push({
              matricula,
              nome: metaByMatricula.get(matricula)?.nome || 'Desconhecido',
              machineIds: missingForThisUser,
              machineCodes: missingForThisUser.map(id => mapping.centrosById.get(id)?.codigo || `ID ${id}`)
            });
          }
        }
      }

      if (mUsers.length > 0 || mLinks.length > 0) {
        pushLog(`⚠️ Atenção: ${mUsers.length} novo(s) funcionário(s) e ${mLinks.length} vínculo(s) ausente(s).`);
        pushLog('Aguardando resolução pelo usuário...');

        setPendingUpload({ file, rows, groups, mapping, avisos: [] });
        setMissingUsers(mUsers);
        setMissingLinks(mLinks);
        setShowLinkModal(true);
        setBusy(false);
        return; // PAUSA AQUI
      }

      // Se tudo OK, persiste direto
      await etapa3Persistir(file, rows, groups);

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
     Callback e Continuação
  ========================== */
  const handleLinkResolutionConfirm = async (
    newUsers: { matricula: string; nome: string; centroIds: number[]; turno: number }[],
    newLinks: { matricula: string; centroIds: number[] }[]
  ) => {
    setShowLinkModal(false);
    setBusy(true);

    try {
      pushLog(`Criando ${newUsers.length} usuários e ${newLinks.length} conjuntos de vínculos...`);

      // 1. Criar Usuários
      for (const u of newUsers) {
        // Cria Meta
        await upsertFuncionarioMeta(empresaId, {
          matricula: u.matricula,
          nome: u.nome,
          meta_diaria_horas: 0, // default
          turno: u.turno
          // area: null 
        });

        // Precisamos do ID gerado para vincular
        // (Como upsertFuncionarioMeta não retorna ID diretamente e é void, vamos buscar novamente.
        //  Poderíamos otimizar, mas a API atual é assim)
        const [func] = (await fetchFuncionariosMeta(empresaId)).filter(f => f.matricula === u.matricula);

        if (func) {
          for (const cid of u.centroIds) {
            await addFuncionarioCentro(empresaId, func.id, cid);
          }
        }
      }

      // 2. Criar Vínculos (para usuários já existentes)
      const metas = await fetchFuncionariosMeta(empresaId);
      for (const l of newLinks) {
        const func = metas.find(f => f.matricula === l.matricula);
        if (func) {
          for (const cid of l.centroIds) {
            // Evitar duplicação se rodar 2x (addFuncionarioCentro não tem onConflict ignore fácil, 
            // mas supomos que o modal filtrou o que faltava)
            await addFuncionarioCentro(empresaId, func.id, cid).catch(() => { });
          }
        }
      }

      pushLog('Vínculos atualizados com sucesso.');

      // Retomar persistência
      if (pendingUpload) {
        await etapa3Persistir(pendingUpload.file, pendingUpload.rows, pendingUpload.groups);
      }

    } catch (err: any) {
      console.error(err);
      const mensagem = err?.message || 'Erro ao criar vínculos.';
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
        Envie o .xlsx. O sistema detecta automaticamente se as horas da máquina mudaram em relação ao último upload.
        <br />Se não mudaram, a <b>referência de tempo</b> da máquina será mantida (badge laranja na TV).
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

      {/* Novo Modal de Resolução de Vínculos */}
      <LinkResolutionModal
        opened={showLinkModal}
        onClose={() => {
          setShowLinkModal(false);
          setPendingUpload(null); // Cancelar upload
          pushLog('Upload cancelado pelo usuário.');
        }}
        onConfirm={handleLinkResolutionConfirm}
        missingUsers={missingUsers}
        missingLinks={missingLinks}
      />

    </div>
  );
}