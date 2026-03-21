/**
 * Curiosity Engine - Markdown Message Renderer
 *
 * Renders assistant messages as parsed markdown with code block styling.
 * User messages render as plain text.
 */

import ReactMarkdown from 'react-markdown';

interface Props {
    content: string;
    role: 'user' | 'assistant' | 'system';
}

export default function MarkdownMessage({ content, role }: Props) {
    if (role === 'user') {
        return <>{content}</>;
    }

    return (
        <ReactMarkdown
            components={{
                code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const isBlock = match || (typeof children === 'string' && children.includes('\n'));
                    if (isBlock) {
                        return (
                            <pre className="code-block">
                                <code className={className} {...props}>
                                    {children}
                                </code>
                            </pre>
                        );
                    }
                    return (
                        <code className="inline-code" {...props}>
                            {children}
                        </code>
                    );
                },
                h1: ({ children }) => <h2 className="md-heading">{children}</h2>,
                h2: ({ children }) => <h3 className="md-heading">{children}</h3>,
                h3: ({ children }) => <h4 className="md-heading">{children}</h4>,
            }}
        >
            {content}
        </ReactMarkdown>
    );
}
