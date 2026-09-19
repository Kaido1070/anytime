import { Component, type ErrorInfo, type ReactNode } from "react";

export class SectionErrorBoundary extends Component<
  { children: ReactNode; fallbackTitle?: string; onReset?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Wany section error", error, info);
  }

  private reset = () => {
    this.setState({ failed: false });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="profile-section-error" role="alert">
        <strong>{this.props.fallbackTitle ?? "تعذر فتح هذا القسم."}</strong>
        <span>باقي الموقع ما زال يعمل. حاول فتح القسم مرة أخرى.</span>
        <button className="secondary" type="button" onClick={this.reset}>
          إعادة المحاولة
        </button>
      </section>
    );
  }
}
