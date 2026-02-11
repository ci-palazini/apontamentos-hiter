//src/features/tv/hooks/useTvData.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    fetchMetasAtuais,
    fetchCentroSeriesRange,
    fetchUltimoDiaComDados,
    fetchUploadsPorDia,
    fetchAvisosAtivos,
    type AvisoTV
} from '../../../services/db';
import { supabase } from '../../../lib/supabaseClient';
import { fracDiaLogico } from '../../../utils/time';
import type { FactoryDayRow } from '../types';
import {
    getNow,
    startOfDayLocal,
    toISO,
    isoToLocalDate,
    addDays,
    daysBetween,
    isSundayISO,
    isSaturdayISO,
    countDaysExcludingSatSun,
    shortBR,
    isCentroAtivoNoDia,
    extractTime,
    chunk
} from '../utils';

export function useTvData(empresaId: number, scope: string | undefined) {
    const [loading, setLoading] = useState(true);

    // Dados de Produção
    const [factoryDays, setFactoryDays] = useState<FactoryDayRow[]>([]);
    const [centrosPerf, setCentrosPerf] = useState<CentroPerf[]>([]);
    const [lastUpdateText, setLastUpdateText] = useState<string>('–');

    // --- NOVO STATE: Texto amigável da data de referência (Ex: "ONTEM • 01/12") ---
    const [dataReferenciaText, setDataReferenciaText] = useState<string>('...');

    const [contextDia, setContextDia] = useState<{ isPast: boolean; isToday: boolean; isFuture: boolean; frac: number; }>({ isPast: false, isToday: false, isFuture: false, frac: 0 });

    // Avisos
    const [avisos, setAvisos] = useState<AvisoTV[]>([]);
    const cancelledRef = useRef(false);

    /* --- DATA FETCHING --- */
    const loadData = useCallback(async () => {
        cancelledRef.current = false;
        try {
            setLoading(true);
            const avisosAtivos = await fetchAvisosAtivos(empresaId, scope || 'geral');
            if (!cancelledRef.current) setAvisos(avisosAtivos);

            const lastDayIso = await fetchUltimoDiaComDados(empresaId);
            if (!lastDayIso) {
                if (!cancelledRef.current) {
                    setFactoryDays([]);
                    setCentrosPerf([]);
                    setLastUpdateText('Sem dados');
                    setDataReferenciaText('Sem dados');
                }
                return;
            }

            // Define a data lógica dos dados (ex: 01/12)
            const diaRefLocal = startOfDayLocal(isoToLocalDate(lastDayIso));

            // --- NOVA LÓGICA DE LABEL DE DATA ---
            const todayLocal = startOfDayLocal(getNow());
            const yesterdayLocal = new Date(todayLocal);
            yesterdayLocal.setDate(yesterdayLocal.getDate() - 1);

            const diaStr = diaRefLocal.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            let labelRef = diaStr;

            if (diaRefLocal.getTime() === todayLocal.getTime()) {
                labelRef = `HOJE • ${diaStr}`;
            } else if (diaRefLocal.getTime() === yesterdayLocal.getTime()) {
                labelRef = `ONTEM • ${diaStr}`;
            } else {
                labelRef = diaStr;
            }

            if (!cancelledRef.current) {
                setDataReferenciaText(labelRef);
            }
            // -------------------------------------

            const uploadsDia = await fetchUploadsPorDia(empresaId, lastDayIso);
            let ativo = uploadsDia.find((u) => u.ativo) ?? uploadsDia.slice().sort((a: any, b: any) => new Date(a.enviado_em).getTime() - new Date(b.enviado_em).getTime()).at(-1) ?? null;

            let horaRefGlobal = '00:00';
            let dataRefGlobalObj = getNow();

            if (ativo) {
                const dt = new Date(ativo.enviado_em);
                if (!localStorage.getItem('TV_DEBUG_DATE')) dataRefGlobalObj = dt;

                // Formata hora do upload para o subtítulo
                const dataStrUpload = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                const horaStrUpload = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                horaRefGlobal = horaStrUpload;

                // Mantemos o lastUpdateText com a data do arquivo para auditoria
                if (!cancelledRef.current) setLastUpdateText(`${dataStrUpload} • ${horaStrUpload}`);
            } else if (!cancelledRef.current) {
                setLastUpdateText('Sem dados');
            }

            const isPast = diaRefLocal < todayLocal;
            const isToday = diaRefLocal.getTime() === todayLocal.getTime();
            const isFuture = !isPast && !isToday;
            const fracGlobal = isPast ? 1 : isFuture ? 0 : fracDiaLogico(horaRefGlobal);

            if (!cancelledRef.current) setContextDia({ isPast, isToday, isFuture, frac: fracGlobal });

            const startMes = new Date(diaRefLocal.getFullYear(), diaRefLocal.getMonth(), 1);
            const diasCorridosMes = countDaysExcludingSatSun(startMes, diaRefLocal);
            const startSerie = addDays(diaRefLocal, -13);

            const { data: centrosRaw } = await supabase.from('centros').select('*').eq('empresa_id', empresaId).order('codigo');
            const centrosAll = centrosRaw ?? [];
            const metasAtuaisAll = await fetchMetasAtuais(empresaId);

            const centrosMap = new Map<number, any>();
            centrosAll.forEach((c: any) => centrosMap.set(c.id, c));
            const idsParaBuscarDados = new Set<number>();
            const idsCards = new Set<number>();
            const parentToChildren = new Map<number, number[]>();

            centrosAll.forEach((c: any) => {
                let belongsToScope = false;
                if (!scope || scope === 'geral') belongsToScope = true;
                else if (c.escopo === scope) belongsToScope = true;
                const pai = c.centro_pai_id ? centrosMap.get(c.centro_pai_id) : null;
                if (isCentroAtivoNoDia(c, diaRefLocal)) {
                    if (pai) {
                        const parentInScope = !scope || scope === 'geral' || pai.escopo === scope;
                        if (belongsToScope || parentInScope) {
                            idsParaBuscarDados.add(c.id);
                            if (parentInScope) idsCards.add(pai.id);
                            const list = parentToChildren.get(pai.id) ?? [];
                            list.push(c.id);
                            parentToChildren.set(pai.id, list);
                            if (pai.exibir_filhos && parentInScope) idsCards.add(c.id);
                        }
                    } else if (belongsToScope) { idsParaBuscarDados.add(c.id); idsCards.add(c.id); }
                }
            });

            let fullHistory: any[] = [];
            if (idsParaBuscarDados.size > 0) {
                fullHistory = await fetchCentroSeriesRange(
                    empresaId, Array.from(idsParaBuscarDados), toISO(startSerie < startMes ? startSerie : startMes), toISO(diaRefLocal)
                );
            }

            const perfCalculada: CentroPerf[] = [];
            const cardIdsArr = Array.from(idsCards);
            const metasMap = new Map<number, number>();
            (metasAtuaisAll as any[]).forEach(m => metasMap.set(m.centro_id, Number(m.meta_horas)));
            const historyAgregadoGlobal = new Map<string, number>();

            cardIdsArr.forEach(cardId => {
                const centroCard = centrosMap.get(cardId);
                if (!centroCard) return;
                const isParent = parentToChildren.has(cardId);
                const hasParent = !!centroCard.centro_pai_id;
                const isPinned = !!centroCard.exibir_filhos && isParent && (scope === centroCard.escopo);
                const childrenIds = parentToChildren.get(cardId) ?? [cardId];
                const metaDiaStandard = metasMap.get(cardId) ?? 0;
                const isRefSaturday = isSaturdayISO(toISO(diaRefLocal));
                const metaDia = isRefSaturday ? 0 : metaDiaStandard; // Se for sábado, meta dia é 0.

                const metaMes = metaDiaStandard * diasCorridosMes;
                let realDia = 0, realMes = 0;
                let lastRefStr = horaRefGlobal;
                let cardIsStale = false;
                const contribuintesList: Contribuinte[] = [];

                childrenIds.forEach(childId => {
                    const childCode = centrosMap.get(childId)?.codigo ?? '?';
                    let childRealDia = 0, childLastRef = horaRefGlobal, childIsStale = false;
                    const hist = fullHistory.filter(h => h.centro_id === childId);
                    hist.forEach(h => {
                        const val = Number(h.produzido_h) || 0;
                        if (h.data_wip >= toISO(startMes) && h.data_wip <= toISO(diaRefLocal)) realMes += val;
                        if (h.data_wip === toISO(diaRefLocal)) {
                            realDia += val; childRealDia += val;
                            if (h.data_referencia) {
                                const refDate = new Date(h.data_referencia);
                                childLastRef = extractTime(refDate);
                                if (!isFuture && !isPast && (dataRefGlobalObj.getTime() - refDate.getTime() > 2 * 60 * 1000)) childIsStale = true;
                            }
                        }
                        if (h.data_wip >= toISO(startSerie)) {
                            if (isParent || !centroCard.centro_pai_id) {
                                const prev = historyAgregadoGlobal.get(h.data_wip) ?? 0;
                                historyAgregadoGlobal.set(h.data_wip, prev + val);
                            }
                        }
                    });
                    if (isParent) contribuintesList.push({ codigo: childCode, real: childRealDia, is_stale: childIsStale, last_ref: childLastRef });
                });

                if (!isParent && !isFuture && !isPast) {
                    const histHoje = fullHistory.find(h => h.centro_id === cardId && h.data_wip === toISO(diaRefLocal));
                    if (histHoje?.data_referencia) {
                        const refDate = new Date(histHoje.data_referencia);
                        if (dataRefGlobalObj.getTime() - refDate.getTime() > 2 * 60 * 1000) cardIsStale = true;
                        lastRefStr = extractTime(refDate);
                    }
                }

                let fracAplicada = fracGlobal;
                if (!isParent && cardIsStale) fracAplicada = fracDiaLogico(lastRefStr);
                const esperado = +(metaDia * fracAplicada).toFixed(2);
                let aderDia: number | null = null;
                if (!isFuture) {
                    if (esperado > 0) aderDia = (realDia / esperado) * 100;
                    else if (isPast && metaDia > 0) aderDia = (realDia / metaDia) * 100;
                    else aderDia = 0;
                }
                const aderMes = metaMes > 0 ? (realMes / metaMes) * 100 : null;
                const pctMetaDia = metaDia > 0 ? (realDia / metaDia) * 100 : null;

                perfCalculada.push({
                    centro_id: cardId, codigo: centroCard.codigo, is_parent: isParent, has_parent: hasParent, pinned: isPinned,
                    meta_dia: +metaDia.toFixed(2), meta_mes: +metaMes.toFixed(2), real_dia: +realDia.toFixed(2), real_mes: +realMes.toFixed(2),
                    esperado_dia: esperado, desvio_dia: +(realDia - esperado).toFixed(2),
                    ader_dia: aderDia ? +aderDia.toFixed(2) : null, pct_meta_dia: pctMetaDia ? +pctMetaDia.toFixed(2) : null,
                    ader_mes: aderMes ? +aderMes.toFixed(2) : null, is_stale: cardIsStale, last_ref_time: lastRefStr,
                    contribuintes: contribuintesList.sort((a, b) => b.real - a.real),
                });
            });

            const metaTotalStandard = perfCalculada.filter(c => c.is_parent || !c.has_parent).reduce((acc, c) => acc + (metasMap.get(c.centro_id) ?? 0), 0);
            const dias = daysBetween(startSerie, diaRefLocal);
            const serieFactory: FactoryDayRow[] = [];
            for (const iso of dias) {
                if (isSundayISO(iso)) continue;
                const isSat = isSaturdayISO(iso);
                const metaDoDia = isSat ? 0 : metaTotalStandard;

                const prod = +(historyAgregadoGlobal.get(iso) ?? 0).toFixed(2);
                const pct = metaDoDia > 0 ? (prod / metaDoDia) * 100 : (prod > 0 ? 100 : 0);
                // metaDisplay: usa gaps (undefined) no sábado para a linha "sumir" visualmente
                const metaDisplay = isSat ? undefined : metaTotalStandard;
                serieFactory.push({ iso, label: shortBR(iso), produzido: prod, meta: metaDoDia, metaDisplay, pct, isSaturday: isSat });
            }

            if (!cancelledRef.current) { setFactoryDays(serieFactory); setCentrosPerf(perfCalculada); }
        } catch (e) { console.error(e); } finally { if (!cancelledRef.current) setLoading(false); }
    }, [empresaId, scope]);

    useEffect(() => { cancelledRef.current = false; loadData(); return () => { cancelledRef.current = true; }; }, [loadData]);
    useEffect(() => { const ch = supabase.channel('tv-realtime').on('postgres_changes', { event: '*', schema: 'public' }, () => loadData()).subscribe(); return () => { supabase.removeChannel(ch); }; }, [loadData]);
    useEffect(() => { const id = window.setInterval(loadData, 60000); return () => window.clearInterval(id); }, [loadData]);

    const resumo = useMemo(() => {
        if (!centrosPerf.length) return { metaMes: 0, realMes: 0, metaDia: 0, realDia: 0, esperadoDia: 0 };
        const lideres = centrosPerf.filter(c => c.is_parent || !c.has_parent);
        return lideres.reduce((acc, c) => {
            acc.metaMes += c.meta_mes; acc.realMes += c.real_mes; acc.metaDia += c.meta_dia; acc.realDia += c.real_dia; acc.esperadoDia += c.esperado_dia;
            return acc;
        }, { metaMes: 0, realMes: 0, metaDia: 0, realDia: 0, esperadoDia: 0 });
    }, [centrosPerf]);

    const centroPages = useMemo(() => {
        const pinnedItems = centrosPerf.filter(c => c.pinned);
        const regularItems = centrosPerf.filter(c => !c.pinned).sort((a, b) => (b.ader_dia ?? -Infinity) - (a.ader_dia ?? -Infinity));
        const slotsPerPage = 6;
        const availableSlots = Math.max(1, slotsPerPage - pinnedItems.length);
        const regularChunks = chunk(regularItems, availableSlots);
        if (regularChunks.length === 0 && pinnedItems.length > 0) return [pinnedItems];
        if (regularChunks.length === 0 && pinnedItems.length === 0) return [];
        return regularChunks.map(c => [...pinnedItems, ...c]);
    }, [centrosPerf]);

    return {
        loading,
        factoryDays,
        centrosPerf,
        lastUpdateText,
        dataReferenciaText, // Retornando a nova variável
        contextDia,
        avisos,
        resumo,
        centroPages
    };
}