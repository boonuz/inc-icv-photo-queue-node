import escpos from 'escpos';
import usb from 'escpos-usb';

// Printer

escpos.USB = usb
const device = new escpos.USB();
const printer = new escpos.Printer(device);

device.open((err) => {
    printer
        .align('CT')
        .text('Queue Number')
        .size(2, 2)
        .text('config.queueNumber')
        .newLine()
        .size(0)
        .text('Scan QR Code to download photo')
        .text('timestamp')
        .cut(true, 4)
        .close()
})