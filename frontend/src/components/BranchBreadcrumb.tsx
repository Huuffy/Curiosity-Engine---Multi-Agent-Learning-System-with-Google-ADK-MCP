/**
 * Curiosity Engine - Branch Breadcrumb
 *
 * Shows the current position in the hierarchy: Topic > Subtopic > Concept
 */

interface Props {
    branch: string[];
}

export default function BranchBreadcrumb({ branch }: Props) {
    if (!branch || branch.length === 0) return null;

    return (
        <div className="branch-breadcrumb">
            {branch.map((name, i) => (
                <span key={i}>
                    {i > 0 && <span className="breadcrumb-separator">&gt;</span>}
                    <span className={i === branch.length - 1 ? 'breadcrumb-current' : 'breadcrumb-item'}>
                        {name}
                    </span>
                </span>
            ))}
        </div>
    );
}
