# POS barcode scanner setup

Midnight EPOS treats USB and Bluetooth **keyboard-wedge** scanners as a fast keyboard that types a barcode and sends Enter.

## Configure the scanner

1. Set the scanner to **keyboard wedge** mode (most retail scanners default to this).
2. Use a **suffix** of Enter/Return after each scan.
3. Avoid prefixes that inject into form fields unless required by your hardware.

## Using scans on the POS page

- Scan while focus is **outside** search or quantity inputs → product adds to cart and plays a success beep.
- Scan while focus is **inside** a text field → characters go to that field normally (no cart add).
- Unknown barcode → fail beep and product search prefills with the scanned code.

## Test without hardware

Paste a 6+ character code and press Enter quickly, or use a scanner emulator that sends keystrokes with < 30ms gaps between characters.
