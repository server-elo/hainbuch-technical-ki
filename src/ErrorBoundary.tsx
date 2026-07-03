import React from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <span className="text-2xl font-black tracking-tight text-red-600">HAINBUCH</span>
            <h1 className="text-lg font-semibold text-neutral-900 mt-4 mb-2">
              Etwas ist schiefgelaufen
            </h1>
            <p className="text-sm text-neutral-500 mb-6">
              Die Oberfläche hat einen unerwarteten Fehler festgestellt. Ihre
              Server-Dienste laufen weiter — laden Sie die Seite einfach neu.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              Neu laden
            </button>
            <pre className="mt-6 text-left text-[10px] text-neutral-400 bg-neutral-50 border border-neutral-200 rounded p-3 overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
