import React from 'react';

const STYLE_BY_VARIANT = {
  primary: 'bg-[#2d5a66] hover:bg-[#234a54] text-white shadow-[0_6px_16px_rgba(45,90,102,0.24)]',
  danger: 'bg-[#b94f3f] hover:bg-[#9f4234] text-white shadow-[0_6px_16px_rgba(185,79,63,0.24)]',
  secondary: 'bg-[#ece6da] hover:bg-[#e0d7c8] text-[#233140]'
};

const ActionButton = ({ label, onClick, isLoading = false, variant = 'primary', disabled = false, fullWidth = true }) => {
  const classes = STYLE_BY_VARIANT[variant] || STYLE_BY_VARIANT.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${fullWidth ? 'w-full' : ''} min-h-[52px] text-[15px] font-semibold rounded-xl px-4 py-3 transition disabled:bg-gray-400 disabled:text-white ${classes}`}
    >
      {isLoading ? 'Loading...' : label}
    </button>
  );
};

export default ActionButton;
