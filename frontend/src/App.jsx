import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import UserUpload from "./pages/UserUpload";
import ShopDashboard from "./pages/ShopDashboard";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/user/upload" element={<UserUpload />} />
          <Route path="/shop/dashboard" element={<ShopDashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;