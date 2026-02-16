//src/services/series.ts
import { supabase } from '../lib/supabaseClient';

export type FabricaDia = { data_wip: string; produzido_h: number };
export type CentroDia = {
    data_wip: string;
    centro_id: number;
    produzido_h: number;
    data_referencia?: string | null;
};

export type PainelMaquinaResumo = {
    data_wip: string;             // 'YYYY-MM-DD'
    ano_mes: string;              // 'YYYY-MM-01'
    centro_id: number;
    codigo: string;
    meta_diaria_horas: number;
    produzido_dia_horas: number;
    produzido_mes_horas: number;
};

export async function fetchFabricaRange(empresaId: number, startISO: string, endISO: string): Promise<FabricaDia[]> {
    const { data, error } = await supabase
        .from('v_fabrica_por_dia')
        .select('data_wip, produzido_h')
        .eq('empresa_id', empresaId)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO)
        .order('data_wip', { ascending: true });
    if (error) throw error;
    return (data ?? []) as FabricaDia[];
}

// Ela busca o snapshot do último upload VÁLIDO do dia.
export async function fetchEstadoAnterior(empresaId: number, dataWip: string) {
    // 1. Achar qual era o upload ativo antes do atual
    const { data: uploadAntigo } = await supabase
        .from('upload_dia_ativo')
        .select('upload_id')
        .eq('data_wip', dataWip)
        .single();

    if (!uploadAntigo) return new Map<number, { horas: number; ref: string }>();

    // 2. Pegar os totais daquele upload (filtrado por empresa)
    const { data: totais } = await supabase
        .from('totais_diarios')
        .select('centro_id, horas_somadas, data_referencia')
        .eq('empresa_id', empresaId)
        .eq('upload_id_origem', uploadAntigo.upload_id);

    const mapa = new Map<number, { horas: number; ref: string }>();

    if (totais) {
        totais.forEach((t: any) => {
            // Garante que temos uma ref, se for null usa data atual como fallback seguro
            const ref = t.data_referencia || new Date().toISOString();
            mapa.set(t.centro_id, {
                horas: Number(t.horas_somadas),
                ref: ref
            });
        });
    }

    return mapa;
}

export async function fetchCentroSeriesRange(empresaId: number, centroIds: number[], startISO: string, endISO: string): Promise<CentroDia[]> {
    if (!centroIds.length) return [];
    const { data, error } = await supabase
        .from('v_centro_por_dia')
        .select('data_wip, centro_id, produzido_h, data_referencia')
        .eq('empresa_id', empresaId)
        .in('centro_id', centroIds)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO)
        .order('data_wip', { ascending: true });
    if (error) throw error;
    return (data ?? []) as CentroDia[];
}

export async function fetchPainelMaquinasResumo(
    empresaId: number,
    diaISO: string,
    anoMesISO: string
): Promise<PainelMaquinaResumo[]> {
    let query = supabase
        .from('v_painel_maquinas_resumo')
        .select('data_wip, ano_mes, centro_id, codigo, meta_diaria_horas, produzido_dia_horas, produzido_mes_horas')
        .eq('empresa_id', empresaId)
        .eq('data_wip', diaISO);

    if (anoMesISO) {
        query = query.eq('ano_mes', anoMesISO);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as PainelMaquinaResumo[];
}

export type ProducaoFuncionario = {
    data_wip: string;
    centro_id: number;
    matricula: string;
    horas_somadas: number;
};

export async function fetchProducaoFuncionarios(
    empresaId: number,
    startISO: string,
    endISO: string
): Promise<ProducaoFuncionario[]> {
    const { data, error } = await supabase
        .from('totais_func_diarios')
        .select('data_wip, centro_id, matricula, horas_somadas')
        .eq('empresa_id', empresaId)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO);
    if (error) throw error;
    return (data ?? []) as ProducaoFuncionario[];
}
