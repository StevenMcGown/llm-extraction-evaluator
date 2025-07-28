import React, { useState, useRef, useEffect } from 'react';

interface InfoTooltipIconProps {
  tooltip: string;
  color: string;
  style?: React.CSSProperties;
}

const InfoTooltipIcon: React.FC<InfoTooltipIconProps> = ({ tooltip, color, style }) => {
  const [hovered, setHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hovered && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.bottom + 5,
        left: rect.right - 200, // Adjust for tooltip width
      });
    }
  }, [hovered]);

  return (
    <>
      <div
        ref={iconRef}
        style={{
          position: 'relative',
          display: 'inline-block',
          ...style,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.9)',
            border: `2px solid ${color}`,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'help',
            fontWeight: 'bold',
            fontStyle: 'italic',
            fontFamily: 'Times, serif',
            color: color,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onMouseOver={e => ((e.target as HTMLElement).style.transform = 'scale(1.1)')}
          onMouseOut={e => ((e.target as HTMLElement).style.transform = 'scale(1)')}
        >
          i
        </div>
      </div>
      
      {hovered && iconRef.current && (
        <div
          style={{
            position: 'fixed',
            top: tooltipPosition.top,
            left: tooltipPosition.left,
            backgroundColor: '#1f2937',
            opacity: 1,
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '15px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontStyle: 'normal',
            fontWeight: 'normal',
            zIndex: 99999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '260px',
            minWidth: '180px',
            whiteSpace: 'normal',
            textAlign: 'left',
            pointerEvents: 'none',
          }}
        >
          {tooltip}
          <div
            style={{
              position: 'absolute',
              top: '-5px',
              left: `${iconRef.current.getBoundingClientRect().left + 10 - tooltipPosition.left}px`,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: '5px solid #1f2937',
            }}
          ></div>
        </div>
      )}
    </>
  );
};

export default InfoTooltipIcon; 