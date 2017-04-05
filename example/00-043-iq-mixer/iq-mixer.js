// Copyright (c) 2015-2017 Robert Rypuła - https://audio-network.rypula.pl
'use strict';

var
    Queue = AudioNetwork.Injector.resolve('Common.Queue'),   // TODO remove this dependency
    audioMonoIO,
    LIMIT_CANVAS_WIDTH = true,
    FFT_SIZE = 1 * 1024,         // powers of 2 in range: 32, 32768
    BUFFER_SIZE = 1 * 1024,
    CANVAS_WIDTH_FREQUENCY = FFT_SIZE * 0.5,
    CANVAS_HEIGHT = 201,
    MAX_WIDTH = LIMIT_CANVAS_WIDTH ? 1024 : Number.POSITIVE_INFINITY,
    DECIBEL_MIN = -150,
    domLocalOscillatorHertzFrequency,
    domLocalOscillatorMiliHertzFrequency,
    ctxFrequencyDomain,
    ctxFrequencyDomainMixed,
    ctxFrequencyDomainFilteredA,
    ctxFrequencyDomainDecimatedA,
    ctxFrequencyDomainFilteredB,
    ctxFrequencyDomainDecimatedB,
    ctxFrequencyDomainZoom,
    zoomBuffer,                           // TODO refactor variable name, etc
    sampleNumber = 0,
    localOscillator,
    firFilterSampleHistoryRealBufferA,
    firFilterSampleHistoryImmBufferA,
    firFilterSampleHistoryRealBufferB,
    firFilterSampleHistoryImmBufferB,
    firFilterCoefficientA,
    firFilterCoefficientB,
    FIR_FILTER_A_DECIMATION = 8,
    FIR_FILTER_B_DECIMATION = 4,
    FIR_FILTER_TRANSITION_BAND = 0.03,
    FIR_FILTER_MARGIN_BAND = 0.01;      // TODO remove it, only for testing purposes

function init() {
    initDomElement();
    initWebAudioApi();

    onLocalOscillatorFrequencyChange();
}

function initDomElement() {
    domLocalOscillatorHertzFrequency = document.getElementById('local-oscillator-hertz-frequency');
    domLocalOscillatorMiliHertzFrequency = document.getElementById('local-oscillator-mili-hertz-frequency');

    ctxFrequencyDomain = getConfiguredCanvasContext('canvas-frequency-domain-00', BUFFER_SIZE, CANVAS_HEIGHT);
    ctxFrequencyDomainMixed = getConfiguredCanvasContext('canvas-frequency-domain-01-mixed', BUFFER_SIZE, CANVAS_HEIGHT);
    ctxFrequencyDomainFilteredA = getConfiguredCanvasContext('canvas-frequency-domain-02-filtered-a', BUFFER_SIZE, CANVAS_HEIGHT);
    ctxFrequencyDomainDecimatedA = getConfiguredCanvasContext('canvas-frequency-domain-03-decimated-a', BUFFER_SIZE / FIR_FILTER_A_DECIMATION, CANVAS_HEIGHT);
    ctxFrequencyDomainFilteredB = getConfiguredCanvasContext('canvas-frequency-domain-04-filtered-b', BUFFER_SIZE / FIR_FILTER_A_DECIMATION, CANVAS_HEIGHT);
    ctxFrequencyDomainDecimatedB = getConfiguredCanvasContext('canvas-frequency-domain-05-decimated-b', BUFFER_SIZE / (FIR_FILTER_A_DECIMATION * FIR_FILTER_B_DECIMATION), CANVAS_HEIGHT);
    ctxFrequencyDomainZoom = getConfiguredCanvasContext('canvas-frequency-domain-06-zoom', BUFFER_SIZE, CANVAS_HEIGHT);
}

function initWebAudioApi() {
    audioMonoIO = new AudioMonoIO(FFT_SIZE, BUFFER_SIZE);

    // we need to put it here because we need audioMonoIO instance
    // and additionally we don't want handler to run before FIR filter initialization
    initFirFilter();

    audioMonoIO.setSampleInHandler(sampleInHandler);
}

function initFirFilter() {
    var numberOfTaps;

    numberOfTaps = getNumberOfTaps(FIR_FILTER_TRANSITION_BAND);
    console.log('Stage A: ', numberOfTaps);
    firFilterCoefficientA = getFirFilterCoefficientLowPassSinc(
        1 / (2 * FIR_FILTER_A_DECIMATION) - FIR_FILTER_TRANSITION_BAND - FIR_FILTER_MARGIN_BAND,
        numberOfTaps
    );
    firFilterSampleHistoryRealBufferA = new Queue(firFilterCoefficientA.length);
    firFilterSampleHistoryImmBufferA = new Queue(firFilterCoefficientA.length);

    numberOfTaps = getNumberOfTaps(FIR_FILTER_TRANSITION_BAND);
    console.log('Stage B: ', numberOfTaps);
    firFilterCoefficientB = getFirFilterCoefficientLowPassSinc(
        1 / (2 * FIR_FILTER_B_DECIMATION) - FIR_FILTER_TRANSITION_BAND - FIR_FILTER_MARGIN_BAND,
        numberOfTaps
    );
    firFilterSampleHistoryRealBufferB = new Queue(firFilterCoefficientB.length);
    firFilterSampleHistoryImmBufferB = new Queue(firFilterCoefficientB.length);

    zoomBuffer = new Queue(BUFFER_SIZE);
}

function onLocalOscillatorFrequencyChange() {
    localOscillator =
        parseFloat(domLocalOscillatorHertzFrequency.value) +
        parseFloat(domLocalOscillatorMiliHertzFrequency.value) / 1000;
}

// -----------------------------------------------------------------------
// recursive DIT FFT (decimation in time)

function fft(input) {
    var
        n = input.length,
        nHalf,
        even,
        odd,
        output = [],
        wnkMultiplied,
        wnk,
        k,
        r;

    if (n === 1) {
        return input;
    }

    // even and odd parts
    even = fft(getListHalf(input, 0));
    odd = fft(getListHalf(input, 1));

    // combine
    output.length = n;
    nHalf = n / 2;
    for (k = 0; k < nHalf; k++) {
        r = -2 * Math.PI * k / n;
        wnk = getComplexFromRadians(r);
        wnkMultiplied = complexMultiply(wnk, odd[k]);
        output[k] = complexAdd(even[k], wnkMultiplied);
        output[nHalf + k] = complexSubtract(even[k], wnkMultiplied);
    }

    return output;
}

function getListHalf(list, offset) {
    var i, listHalf, item, lengthHalf;

    listHalf = [];
    lengthHalf = list.length / 2;
    for (i = 0; i < lengthHalf; i++) {
        item = list[i * 2 + offset];
        listHalf.push(item);
    }

    return listHalf;
}

function getComplexFromRadians(r) {
    return {
        real: Math.cos(r),
        imm: Math.sin(r)
    }
}

function complexMultiply(a, b) {
    return {
        real: a.real * b.real - a.imm * b.imm,
        imm: a.real * b.imm + a.imm * b.real
    };
}

function complexSubtract(a, b) {
    return {
        real: a.real - b.real,
        imm: a.imm - b.imm
    };
}

function complexAdd(a, b) {
    return {
        real: a.real + b.real,
        imm: a.imm + b.imm
    };
}

// -----------------------------------------------------------------------
// fft utils

function applyWindowFunctionComplex(input) {
    var i, windowValue, length, output, complex;

    output = [];
    length = input.length;
    for (i = 0; i < length; i++) {
        windowValue = blackmanNuttall(i, length);
        complex = complexScale(input[i], windowValue);
        output.push(complex);
    }

    return output;
}

function getFrequencyDomainDecibel(frequencyDomain) {
    var i, decibel, magnitude, magnitudeNormalized;

    decibel = [];
    decibel.length = frequencyDomain.length;
    for (i = 0; i < frequencyDomain.length; i++) {
        magnitude = Math.sqrt(
            frequencyDomain[i].real * frequencyDomain[i].real +
            frequencyDomain[i].imm * frequencyDomain[i].imm
        );
        magnitudeNormalized = magnitude / frequencyDomain.length;
        decibel[i] = 20 * Math.log(magnitudeNormalized) / Math.LN10;
    }

    return decibel;
}

function getFrequencyData(timeDomain) {
    var timeDomainWindowed, frequencyDomain, frequencyDomainDecibel;

    timeDomainWindowed = applyWindowFunctionComplex(timeDomain);
    frequencyDomain = fft(timeDomainWindowed);
    fftShift(frequencyDomain);
    frequencyDomainDecibel = getFrequencyDomainDecibel(frequencyDomain);

    return frequencyDomainDecibel;
}

// -----------------------------------------------------------------------
// iq mixer

function getTimeDomainMixed(timeDomain, sampleNumber, localOscillatorFrequency, sampleRate) {
    var i, n, output, complexSin, timeDomainMixed, omega;

    output = [];
    omega = -2 * Math.PI * localOscillatorFrequency / sampleRate;
    for (i = 0; i < timeDomain.length; i++) {
        n = sampleNumber + i;
        complexSin = getComplexFromRadians(omega * n);
        timeDomainMixed = complexMultiply(timeDomain[i], complexSin);
        output.push(timeDomainMixed);
    }

    return output;
}

// -----------------------------------------------------------------------
// Finite Impulse Response filter

function getFirFilterCoefficientLowPassSinc(cutoffNormalized, numberOfTaps) {
    var n, middleIndex, output;

    middleIndex = (numberOfTaps - 1) / 2;
    output = [];
    for (n = 0; n < numberOfTaps; n++) {
        output[n] = sinc(2 * cutoffNormalized * (n - middleIndex));
    }

    return output;
}

function sinc(x) {
    return x !== 0
        ? Math.sin(Math.PI * x) / (Math.PI * x)
        : 1;
}

function applyWindowFunctionAndNormalize(input) {
    var i, windowValue, length, output, newValue, sum;

    output = [];
    length = input.length;
    sum = 0;
    for (i = 0; i < length; i++) {
        windowValue = blackmanNuttall(i, length);
        newValue = input[i] * windowValue;
        sum += newValue;
        output.push(newValue);
    }
    for (i = 0; i < length; i++) {
        output[i] /= sum;
    }
    
    return output;
}

function getNumberOfTaps(transitionBandNormalized) {
    // http://dsp.stackexchange.com/questions/31066/how-many-taps-does-an-fir-filter-need
    var
        pb = Math.pow(10, -4),  // pass band: 0.1% of amplitude variations gives -40dB
        sb = Math.pow(10, -6),  // stop band: 60 dB should be fine
        logValue,
        numberOfTabs;

    logValue = Math.log(1 / (10 * pb * sb)) / Math.LN10;
    numberOfTabs = (2 / 3) * logValue * (1 / transitionBandNormalized);
    numberOfTabs = Math.round(numberOfTabs);
    numberOfTabs = numberOfTabs % 2 ? numberOfTabs : numberOfTabs + 1;  // keep this number always odd for symmetry

    return numberOfTabs;
}

function getFilteredSample(sampleHistoryBuffer, coefficient) {
    var i, sampleFiltered, length;

    length = coefficient.length;
    sampleFiltered = 0;
    if (sampleHistoryBuffer.getSize() === length) {   // let's wait for buffer to fill completely...
        for (i = 0; i < length; i++) {
            sampleFiltered += sampleHistoryBuffer.getItem(i) * coefficient[i];
        }
    }

    return sampleFiltered;
}

function getTimeDomainFiltered(timeDomain, sampleHistoryBuffer, coefficient, decimate) {
    var output, length, i, filteredSample;

    output = [];
    length = timeDomain.length;
    for (i = 0; i < length; i++) {
        sampleHistoryBuffer.pushEvenIfFull(timeDomain[i]);
        // important: in order to keep alignment timeDomain.length and decimate should be power of two!
        if (!decimate || i % decimate === 0) {
            filteredSample = getFilteredSample(sampleHistoryBuffer, coefficient);
            output.push(filteredSample);
        }
    }

    return output;
}

function getTimeDomainComplexFiltered(timeDomainComplex, sampleHistoryRealBuffer, sampleHistoryImmBuffer, coefficient, decimate) {
    var output, length, i, filteredRealSample, filteredImmSample, complex;

    output = [];
    length = timeDomainComplex.length;
    for (i = 0; i < length; i++) {
        sampleHistoryRealBuffer.pushEvenIfFull(timeDomainComplex[i].real);
        sampleHistoryImmBuffer.pushEvenIfFull(timeDomainComplex[i].imm);
        // important: in order to keep alignment timeDomain.length and decimate should be power of two!
        if (!decimate || i % decimate === 0) {
            filteredRealSample = getFilteredSample(sampleHistoryRealBuffer, coefficient);
            filteredImmSample = getFilteredSample(sampleHistoryImmBuffer, coefficient);
            complex = {
                real: filteredRealSample,
                imm: filteredImmSample
            };
            output.push(complex);
        }
    }

    return output;
}

// -----------------------------------------------------------------------
// common

function fftShift(frequencyDomain) {
    var i, lengthHalf, tmp;

    lengthHalf = frequencyDomain.length / 2;      // this is assuming even lengths!
    for (i = 0; i < lengthHalf; i++) {
        tmp = frequencyDomain[i];
        frequencyDomain[i] = frequencyDomain[lengthHalf + i];
        frequencyDomain[lengthHalf + i] = tmp;
    }
}

function complexClone(complex) {
    return {
        real: complex.real,
        imm: complex.imm
    };
}

function complexScale(complex, scale) {
    var output = complexClone(complex);

    output.real *= scale;
    output.imm *= scale;

    return output;
}

function blackmanNuttall(n, N) {
    return 0.3635819
        - 0.4891775 * Math.cos(2 * Math.PI * n / (N - 1))
        + 0.1365995 * Math.cos(4 * Math.PI * n / (N - 1))
        - 0.0106411 * Math.cos(6 * Math.PI * n / (N - 1));
}

function convertRealSignalToComplexSignal(input) {
    var i, output, complex;

    output = [];
    for (i = 0; i < input.length; i++) {
        complex = {
            real: input[i],
            imm: 0
        };
        output.push(complex);
    }

    return output;
}

function getDecimated(input, decimate) {
    var output, length, i;

    output = [];
    length = input.length;
    // important: in order to keep alignment timeDomain.length and decimate should be power of two!
    for (i = 0; i < length; i += decimate) {
        output.push(input[i]);
    }

    return output;
}

// -----------------------------------------------------------------------
// animation, canvas 2d context

function clear(ctx) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawLine(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.stroke();
}

function getConfiguredCanvasContext(elementId, width, height) {
    var element, ctx;

    element = document.getElementById(elementId);
    element.width = Math.min(MAX_WIDTH, width);
    element.height = height;
    ctx = element.getContext('2d');
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#EEE';

    return ctx;
}

function drawFrequencyDomainData(ctx, data) {
    var limit, hMaxPix, x, y1, y2;

    clear(ctx);

    hMaxPix = CANVAS_HEIGHT - 1;
    limit = Math.min(MAX_WIDTH, data.length);
    for (x = 0; x < limit - 1; x++) {
        y1 = hMaxPix * (data[x] / DECIBEL_MIN);
        y2 = hMaxPix * (data[x + 1] / DECIBEL_MIN);
        drawLine(ctx, x, y1, x + 1, y2);
    }
}

// -----------------------------------------------------------------------
// data handlers

function sampleInHandler(monoIn) {
    var
        i,
        timeDomain,
        timeDomainMixed,
        timeDomainFilteredA,
        timeDomainDecimatedA,
        timeDomainFilteredB,
        timeDomainDecimatedB,
        timeDomainZoom,
        frequencyData,
        frequencyDataMixed,
        frequencyDataFilteredA,
        frequencyDataDecimatedA,
        frequencyDataFilteredB,
        frequencyDataDecimatedB,
        frequencyDataZoom;

    // convert real signal to complex signal
    timeDomain = convertRealSignalToComplexSignal(monoIn);

    // untouched signal
    frequencyData = getFrequencyData(timeDomain);
    drawFrequencyDomainData(ctxFrequencyDomain, frequencyData);

    // mixed signal
    timeDomainMixed = getTimeDomainMixed(timeDomain, sampleNumber, localOscillator, audioMonoIO.getSampleRate());
    sampleNumber += timeDomain.length;
    frequencyDataMixed = getFrequencyData(timeDomainMixed);
    drawFrequencyDomainData(ctxFrequencyDomainMixed, frequencyDataMixed);

    // filtering/decimation stage A
    timeDomainFilteredA = getTimeDomainComplexFiltered(timeDomainMixed, firFilterSampleHistoryRealBufferA, firFilterSampleHistoryImmBufferA, firFilterCoefficientA);
    frequencyDataFilteredA = getFrequencyData(timeDomainFilteredA);
    drawFrequencyDomainData(ctxFrequencyDomainFilteredA, frequencyDataFilteredA);
    timeDomainDecimatedA = getDecimated(timeDomainFilteredA, FIR_FILTER_A_DECIMATION);
    frequencyDataDecimatedA = getFrequencyData(timeDomainDecimatedA);
    drawFrequencyDomainData(ctxFrequencyDomainDecimatedA, frequencyDataDecimatedA);

    // filtering/decimation stage B
    timeDomainFilteredB = getTimeDomainComplexFiltered(timeDomainDecimatedA, firFilterSampleHistoryRealBufferB, firFilterSampleHistoryImmBufferB, firFilterCoefficientB);
    frequencyDataFilteredB = getFrequencyData(timeDomainFilteredB);
    drawFrequencyDomainData(ctxFrequencyDomainFilteredB, frequencyDataFilteredB);
    timeDomainDecimatedB = getDecimated(timeDomainFilteredB, FIR_FILTER_B_DECIMATION);
    frequencyDataDecimatedB = getFrequencyData(timeDomainDecimatedB);
    drawFrequencyDomainData(ctxFrequencyDomainDecimatedB, frequencyDataDecimatedB);

    // zoom
    for (i = 0; i < timeDomainDecimatedB.length; i++) {
        zoomBuffer.pushEvenIfFull(timeDomainDecimatedB[i]);
    }
    timeDomainZoom = [];
    for (i = 0; i < zoomBuffer.getSize(); i++) {
        timeDomainZoom.push(zoomBuffer.getItem(i));
    }
    if (timeDomain.length === timeDomainZoom.length) {
        frequencyDataZoom = getFrequencyData(timeDomainZoom);
        drawFrequencyDomainData(ctxFrequencyDomainZoom, frequencyDataZoom);
    }
}
