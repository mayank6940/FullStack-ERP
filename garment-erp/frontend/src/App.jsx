import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { PrivateRoute } from './components/PrivateRoute';

// Pages
const Login = lazy(() => import('./portals/admin/Login'));
const SetupCredential = lazy(() => import('./portals/admin/SetupCredential'));

// Portals
const AdminPortal = lazy(() => import('./portals/admin/AdminPortal'));
const ManagerPortal = lazy(() => import('./portals/manager/ManagerPortal'));
const FabricPortal = lazy(() => import('./portals/fabric/FabricPortal'));
const CutterPortal = lazy(() => import('./portals/cutter/CutterPortal'));
const TailorPortal = lazy(() => import('./portals/tailor/TailorPortal'));
const SupervisorPortal = lazy(() => import('./portals/supervisor/SupervisorPortal'));

const PageFallback = () => (
  <div className="min-h-screen bg-gray-50 p-6">
    <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 w-1/3 rounded bg-gray-200" />
      <div className="h-28 rounded bg-gray-200" />
      <div className="h-28 rounded bg-gray-200" />
    </div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/new-user-reg" element={<SetupCredential />} />
              <Route path="/setup-credential" element={<Navigate to="/new-user-reg" replace />} />

              {/* Admin Portal */}
              <Route
                path="/admin"
                element={
                  <PrivateRoute allowedRoles={['ADMIN']}>
                    <AdminPortal />
                  </PrivateRoute>
                }
              />

              {/* Manager Portal */}
              <Route
                path="/manager"
                element={
                  <PrivateRoute allowedRoles={['MANAGER']}>
                    <ManagerPortal />
                  </PrivateRoute>
                }
              />

              {/* Fabric Man Portal */}
              <Route
                path="/fabric"
                element={
                  <PrivateRoute allowedRoles={['FABRIC_MAN']}>
                    <FabricPortal />
                  </PrivateRoute>
                }
              />

              {/* Cutter Portal */}
              <Route
                path="/cutter"
                element={
                  <PrivateRoute allowedRoles={['CUTTER']}>
                    <CutterPortal />
                  </PrivateRoute>
                }
              />

              {/* Tailor Portal */}
              <Route
                path="/tailor"
                element={
                  <PrivateRoute allowedRoles={['TAILOR']}>
                    <TailorPortal />
                  </PrivateRoute>
                }
              />

              {/* Supervisor Portal */}
              <Route
                path="/supervisor"
                element={
                  <PrivateRoute allowedRoles={['SUPERVISOR']}>
                    <SupervisorPortal />
                  </PrivateRoute>
                }
              />

              {/* Default route */}
              <Route path="/" element={<Navigate to="/login" />} />
            </Routes>
          </Suspense>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
