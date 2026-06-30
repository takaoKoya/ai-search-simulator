"use client";

import { useState, useEffect } from "react";
import {
  listSessions,
  saveSession,
  deleteSession,
  exportJson,
  importJson,
  encodeToUrl,
  SavedSession,
} from "@/lib/storage";
import { Save, FolderOpen, Download, Upload, Link, Trash2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  currentData: Record<string, unknown>;
  onLoad: (data: Record<string, unknown>) => void;
}

export default function SavePanel({ currentData, onLoad }: Props) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [saveName, setSaveName] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  const handleSave = () => {
    const name = saveName.trim() || `保存 ${new Date().toLocaleString("ja-JP")}`;
    saveSession(name, currentData);
    setSessions(listSessions());
    setSaveName("");
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  const handleDelete = (id: string) => {
    deleteSession(id);
    setSessions(listSessions());
  };

  const handleLoad = (session: SavedSession) => {
    onLoad(session.data);
  };

  const handleExport = () => {
    const name = saveName.trim() || `export-${new Date().toISOString().slice(0, 10)}`;
    exportJson(name, currentData);
  };

  const handleImport = async () => {
    try {
      const data = await importJson();
      onLoad(data);
    } catch {
      alert("読み込みに失敗しました。正しいJSONファイルを選択してください。");
    }
  };

  const handleCopyUrl = async () => {
    const url = encodeToUrl(currentData);
    await navigator.clipboard.writeText(url);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>保存 / 読み込み</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Save name input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="保存名（例：株式会社〇〇）"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={handleSave}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {savedMsg ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {savedMsg ? "保存済み" : "ブラウザ保存"}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            JSONで保存
          </button>
          <button
            onClick={handleImport}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-600 text-white hover:bg-gray-700 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            JSONを開く
          </button>
          <button
            onClick={handleCopyUrl}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
          >
            {urlCopied ? <Check className="w-3.5 h-3.5" /> : <Link className="w-3.5 h-3.5" />}
            {urlCopied ? "コピー済み" : "URLをコピー"}
          </button>
        </div>

        <p className="text-xs text-gray-400">
          URLコピー：入力内容をURLに埋め込みます。そのURLを開くと同じ状態が復元されます。
        </p>

        {/* Saved sessions */}
        {sessions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              保存済み（{sessions.length}件）
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(s.savedAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleLoad(s)}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                    >
                      <FolderOpen className="w-3 h-3" />
                      読み込み
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
