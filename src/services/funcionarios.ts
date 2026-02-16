//src/services/funcionarios.ts
import { supabase } from '../lib/supabaseClient';

export type AreaFuncionario = 'Montagem' | 'Pintura' | 'Usinagem';

export type FuncionarioMeta = {
    id: number;
    matricula: string;
    nome: string;
    meta_diaria_horas: number;
    area: AreaFuncionario | null;
    ativo: boolean;
    turno: number;
};

export type FuncionarioDia = {
    data_wip: string;     // 'YYYY-MM-DD'
    matricula: string;
    produzido_h: number;
};

export type FuncionarioMes = {
    ano_mes: string;      // 'YYYY-MM-01'
    matricula: string;
    produzido_h: number;
};

export type FuncDia = { data_wip: string; matricula: string; produzido_h: number };
export type RankItem = { matricula: string; horas: number };
export type FuncCentroDia = { data_wip: string; centro_id: number; produzido_h: number };

export async function fetchFuncionarios(empresaId: number): Promise<string[]> {
    const { data, error } = await supabase
        .from('v_funcionarios')
        .select('matricula')
        .eq('empresa_id', empresaId)
        .order('matricula', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => String(r.matricula));
}

export async function fetchFuncionarioRange(empresaId: number, matricula: string, startISO: string, endISO: string): Promise<FuncDia[]> {
    const { data, error } = await supabase
        .from('v_funcionario_por_dia')
        .select('data_wip, matricula, produzido_h')
        .eq('empresa_id', empresaId)
        .eq('matricula', matricula)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO)
        .order('data_wip', { ascending: true });
    if (error) throw error;
    return (data ?? []) as FuncDia[];
}

export async function fetchRankingFuncionarios(empresaId: number, startISO: string, endISO: string, limit = 10): Promise<RankItem[]> {
    const { data, error } = await supabase
        .from('v_funcionario_por_dia')
        .select('matricula, produzido_h')
        .eq('empresa_id', empresaId)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO);

    if (error) throw error;

    const acc = new Map<string, number>();
    for (const r of (data ?? []) as FuncDia[]) {
        acc.set(r.matricula, (acc.get(r.matricula) ?? 0) + Number(r.produzido_h));
    }
    return [...acc.entries()]
        .map(([matricula, horas]) => ({ matricula, horas: +horas.toFixed(2) }))
        .sort((a, b) => b.horas - a.horas)
        .slice(0, limit);
}

export async function fetchFuncionarioCentroRange(
    empresaId: number,
    matricula: string,
    startISO: string,
    endISO: string
): Promise<FuncCentroDia[]> {
    const { data, error } = await supabase
        .from('v_funcionario_centro_por_dia')
        .select('data_wip, centro_id, produzido_h')
        .eq('empresa_id', empresaId)
        .eq('matricula', matricula)
        .gte('data_wip', startISO)
        .lte('data_wip', endISO)
        .order('data_wip', { ascending: true });

    if (error) throw error;
    return (data ?? []) as FuncCentroDia[];
}

export async function fetchFuncionariosMeta(empresaId: number): Promise<FuncionarioMeta[]> {
    const { data, error } = await supabase
        .from('funcionarios_meta')
        .select('id, matricula, nome, meta_diaria_horas, area, ativo, turno')
        .eq('empresa_id', empresaId)
        .order('matricula', { ascending: true });
    if (error) throw error;
    // Garantir default 1 se nulo (caso migration antiga)
    return (data ?? []).map((f: any) => ({ ...f, turno: f.turno || 1 })) as FuncionarioMeta[];
}

export async function upsertFuncionarioMeta(
    empresaId: number,
    f: Partial<FuncionarioMeta> & { matricula: string; nome: string; turno?: number }
): Promise<void> {
    const payload: any = {
        matricula: f.matricula,
        nome: f.nome,
        empresa_id: empresaId,
        meta_diaria_horas: f.meta_diaria_horas ?? 8,
        ativo: f.ativo ?? true,
        turno: f.turno || 1
    };
    if (f.area) payload.area = f.area;
    if (f.id) {
        payload.id = f.id;
    } else {
        // Se for insert, tenta match na matricula
        const { data: existing } = await supabase
            .from('funcionarios_meta')
            .select('id')
            .eq('empresa_id', empresaId)
            .eq('matricula', f.matricula)
            .maybeSingle();
        if (existing) payload.id = existing.id;
    }

    const { error } = await supabase.from('funcionarios_meta').upsert(payload);
    if (error) throw error;
}

export async function fetchFuncionariosDia(empresaId: number, dataISO: string): Promise<FuncionarioDia[]> {
    const { data, error } = await supabase
        .from('v_funcionario_por_dia')
        .select('data_wip, matricula, produzido_h')
        .eq('empresa_id', empresaId)
        .eq('data_wip', dataISO);

    if (error) throw error;
    return (data ?? []) as FuncionarioDia[];
}

export async function fetchFuncionariosMes(empresaId: number, anoMesISO: string): Promise<FuncionarioMes[]> {
    // anoMesISO = '2025-11-01' (primeiro dia do mês)
    const { data, error } = await supabase
        .from('v_funcionario_por_mes')
        .select('ano_mes, matricula, produzido_h')
        .eq('empresa_id', empresaId)
        .eq('ano_mes', anoMesISO);

    if (error) throw error;
    return (data ?? []) as FuncionarioMes[];
}

/* =========================================================================
   Vínculos Funcionário ↔ Centro (máquina)
   ========================================================================= */

export type FuncionarioCentro = {
    id: number;
    funcionario_meta_id: number;
    centro_id: number;
    empresa_id: number;
};

export type FuncionarioComCentros = FuncionarioMeta & {
    centros: number[];  // array de centro_ids vinculados
};

/** Busca todos os vínculos funcionário-centro da empresa */
export async function fetchFuncionarioCentros(empresaId: number): Promise<FuncionarioCentro[]> {
    const { data, error } = await supabase
        .from('funcionario_centros')
        .select('id, funcionario_meta_id, centro_id, empresa_id')
        .eq('empresa_id', empresaId);
    if (error) throw error;
    return (data ?? []) as FuncionarioCentro[];
}

/** Adiciona um vínculo funcionário → centro */
export async function addFuncionarioCentro(
    empresaId: number,
    funcMetaId: number,
    centroId: number
): Promise<void> {
    const { error } = await supabase
        .from('funcionario_centros')
        .insert({ funcionario_meta_id: funcMetaId, centro_id: centroId, empresa_id: empresaId });
    if (error) throw error;
}

/** Remove um vínculo pelo ID */
export async function removeFuncionarioCentro(id: number): Promise<void> {
    const { error } = await supabase
        .from('funcionario_centros')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

/** Define os centros de um funcionário (remove todos e insere novos) */
export async function setFuncionarioCentros(
    empresaId: number,
    funcMetaId: number,
    centroIds: number[]
): Promise<void> {
    // Remove vínculos existentes
    const { error: delErr } = await supabase
        .from('funcionario_centros')
        .delete()
        .eq('funcionario_meta_id', funcMetaId)
        .eq('empresa_id', empresaId);
    if (delErr) throw delErr;

    // Insere novos
    if (centroIds.length > 0) {
        const rows = centroIds.map(cid => ({
            funcionario_meta_id: funcMetaId,
            centro_id: cid,
            empresa_id: empresaId,
        }));
        const { error: insErr } = await supabase
            .from('funcionario_centros')
            .insert(rows);
        if (insErr) throw insErr;
    }
}

/** Retorna todos os funcionários com seus centros vinculados */
export async function fetchFuncionariosComCentros(empresaId: number): Promise<FuncionarioComCentros[]> {
    const [metas, vinculos] = await Promise.all([
        fetchFuncionariosMeta(empresaId),
        fetchFuncionarioCentros(empresaId),
    ]);

    // Agrupa centros por funcionario_meta_id
    const centrosByFunc = new Map<number, number[]>();
    for (const v of vinculos) {
        const arr = centrosByFunc.get(v.funcionario_meta_id) ?? [];
        arr.push(v.centro_id);
        centrosByFunc.set(v.funcionario_meta_id, arr);
    }

    return metas.map(m => ({
        ...m,
        centros: centrosByFunc.get(m.id) ?? [],
    }));
}
