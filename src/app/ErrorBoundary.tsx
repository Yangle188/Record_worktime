import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** 兜底错误边界：单个页面出错时给出可见反馈，而不是白屏（TECH-DESIGN §3）。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面发生错误：', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page">
        <section className="card">
          <h2>界面出错了</h2>
          <p className="card__footnote">本机的打卡数据未受影响，重新加载即可继续。</p>
          <pre className="error-detail">{error.message}</pre>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </section>
      </div>
    );
  }
}
