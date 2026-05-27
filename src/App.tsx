import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import UploadPage from './features/upload/UploadPage';
import DashboardDia from './features/dia/DashboardDia';
import GraficosPage from './features/graficos/GraficosPage';
import UploadDetalhePage from './features/upload/UploadDetalhePage';
import ConfigGeralPage from './features/config/ConfigGeralPage';
import RendimentoPage from './features/funcionario/RendFuncionarioPage';
import TvDashboardPage from './features/tv/TvDashboardPage';
import TvMenuPage from './features/tv/TvMenuPage';
import AvisosAdminPage from './features/tv/AvisosAdminPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rotas administrativas com Layout */}
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dia" replace />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/upload/:data/:uploadId" element={<UploadDetalhePage />} />
          <Route path="/dia" element={<DashboardDia />} />
          <Route path="/avisos" element={<AvisosAdminPage />} />
          <Route path="/rendimento" element={<RendimentoPage />} />
          <Route path="/graficos" element={<GraficosPage />} />
          <Route path="/config" element={<ConfigGeralPage />} />
        </Route>

        {/* Rotas TV */}
        <Route path="/tv" element={<TvMenuPage />} /> {/* Menu Principal */}
        <Route path="/tv/:scope" element={<TvDashboardPage />} /> {/* Painel com filtro (geral/usinagem/montagem) */}
      </Routes>
    </BrowserRouter>
  );
}