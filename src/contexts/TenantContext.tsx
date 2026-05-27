import { createContext, useContext, type ReactNode } from 'react';

export type Empresa = {
  id: number;
  slug: string;
  nome: string;
};

const HITER: Empresa = { id: 2, slug: 'hiter', nome: 'Hiter Controls' };

type TenantContextType = {
  empresa: Empresa;
  empresaId: number;
};

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  return (
    <TenantContext.Provider value={{ empresa: HITER, empresaId: HITER.id }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextType {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant deve ser usado dentro de TenantProvider');
  }
  return context;
}

export function useEmpresaId(): number {
  return useTenant().empresaId;
}
