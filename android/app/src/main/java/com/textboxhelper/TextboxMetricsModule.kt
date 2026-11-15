package com.textboxhelper

import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File
import kotlin.math.max
import kotlin.math.min

/**
 * Android native bridge for textbox text measurement.
 *
 * The JavaScript side uses this module whenever wrapping, line boxes, and final textbox
 * heights need to follow Android's actual text layout behavior instead of a rough estimate.
 */
class TextboxMetricsModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "TextboxMetrics"

  @ReactMethod
  fun measureTextLayout(options: ReadableMap, promise: Promise) {
    try {
      val measurement = buildMeasurement(options)
      val layout = measurement.layout

      var maxLineWidth = 0.0
      for (index in 0 until layout.lineCount) {
        maxLineWidth = maxOf(maxLineWidth, layout.getLineWidth(index).toDouble())
      }

      val result = Arguments.createMap().apply {
        putString("text", measurement.text)
        putInt("requestedWidth", measurement.width)
        putDouble("requestedFontSize", measurement.fontSize.toDouble())
        putBoolean("includePad", measurement.includePad)
        putString("fontPath", measurement.fontPath)
        putString("typefaceStatus", measurement.typefaceStatus)
        putInt("layoutHeight", layout.height)
        putInt("lineCount", layout.lineCount)
        putDouble("maxLineWidth", maxLineWidth)
      }

      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("E_MEASURE_TEXT", error)
    }
  }

  @ReactMethod
  fun measureTextLayoutDetailed(options: ReadableMap, promise: Promise) {
    try {
      val measurement = buildMeasurement(options)
      val layout = measurement.layout

      var maxLineWidth = 0.0
      val lines = Arguments.createArray()
      for (index in 0 until layout.lineCount) {
        val lineWidth = layout.getLineWidth(index).toDouble()
        maxLineWidth = max(maxLineWidth, lineWidth)
        val line = Arguments.createMap().apply {
          putInt("index", index)
          putInt("start", layout.getLineStart(index))
          putInt("end", layout.getLineEnd(index))
          putDouble("left", layout.getLineLeft(index).toDouble())
          putDouble("right", layout.getLineRight(index).toDouble())
          putDouble("top", layout.getLineTop(index).toDouble())
          putDouble("bottom", layout.getLineBottom(index).toDouble())
          putDouble("baseline", layout.getLineBaseline(index).toDouble())
          putDouble("width", lineWidth)
        }
        lines.pushMap(line)
      }

      val words = Arguments.createArray()
      val wordRegex = Regex("\\S+")
      for (match in wordRegex.findAll(measurement.text)) {
        val wordStart = match.range.first
        val wordEndExclusive = match.range.last + 1
        var segmentStart = wordStart

        while (segmentStart < wordEndExclusive) {
          val lineIndex = layout.getLineForOffset(segmentStart)
          val segmentEndExclusive = min(wordEndExclusive, layout.getLineEnd(lineIndex))
          if (segmentEndExclusive <= segmentStart) {
            break
          }

          val segmentLeft = layout.getPrimaryHorizontal(segmentStart)
          val segmentRight = layout.getPrimaryHorizontal(segmentEndExclusive)
          val left = min(segmentLeft, segmentRight).toDouble()
          val right = max(segmentLeft, segmentRight).toDouble()
          val top = layout.getLineTop(lineIndex).toDouble()
          val bottom = layout.getLineBottom(lineIndex).toDouble()
          val text = measurement.text.substring(segmentStart, segmentEndExclusive)

          val word = Arguments.createMap().apply {
            putInt("start", segmentStart)
            putInt("end", segmentEndExclusive)
            putInt("tokenStart", wordStart)
            putInt("tokenEnd", wordEndExclusive)
            putInt("lineIndex", lineIndex)
            putString("text", text)
            putDouble("left", left)
            putDouble("right", right)
            putDouble("top", top)
            putDouble("bottom", bottom)
            putDouble("width", right - left)
            putDouble("height", bottom - top)
            putDouble("centerX", (left + right) / 2.0)
            putDouble("centerY", (top + bottom) / 2.0)
          }
          words.pushMap(word)
          segmentStart = segmentEndExclusive
        }
      }

      val result = Arguments.createMap().apply {
        putString("text", measurement.text)
        putInt("requestedWidth", measurement.width)
        putDouble("requestedFontSize", measurement.fontSize.toDouble())
        putBoolean("includePad", measurement.includePad)
        putString("fontPath", measurement.fontPath)
        putString("typefaceStatus", measurement.typefaceStatus)
        putInt("layoutHeight", layout.height)
        putInt("lineCount", layout.lineCount)
        putDouble("maxLineWidth", maxLineWidth)
        putArray("lines", lines)
        putArray("words", words)
      }

      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("E_MEASURE_TEXT_DETAILED", error)
    }
  }

  private data class MeasurementContext(
    val text: String,
    val width: Int,
    val fontSize: Float,
    val includePad: Boolean,
    val fontPath: String?,
    val typefaceStatus: String,
    val layout: StaticLayout
  )

  /** The typeface used for a measurement, and why: "default: no fontPath", "loaded", "missing", ... */
  private data class TypefaceResult(
    val typeface: Typeface?,
    val status: String
  )

  private fun buildMeasurement(options: ReadableMap): MeasurementContext {
    val text = options.getString("text") ?: ""
    val width = options.getInt("width")
    val fontSize = options.getDouble("fontSize").toFloat()
    val includePad = if (options.hasKey("includePad")) {
      options.getBoolean("includePad")
    } else {
      true
    }
    val fontPath = if (options.hasKey("fontPath") && !options.isNull("fontPath")) {
      options.getString("fontPath")
    } else {
      null
    }

    if (width < 0) {
      throw IllegalArgumentException("width must be >= 0")
    }

    val typefaceResult = loadTypeface(fontPath)
    val paint = TextPaint().apply {
      isAntiAlias = true
      textSize = fontSize
      typeface = typefaceResult.typeface
    }

    val layout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setIncludePad(includePad)
        .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
        .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
        .build()
    } else {
      @Suppress("DEPRECATION")
      StaticLayout(
        text,
        paint,
        width,
        Layout.Alignment.ALIGN_NORMAL,
        1.0f,
        0.0f,
        includePad
      )
    }

    return MeasurementContext(
      text = text,
      width = width,
      fontSize = fontSize,
      includePad = includePad,
      fontPath = fontPath,
      typefaceStatus = typefaceResult.status,
      layout = layout
    )
  }

  /**
   * Loads the textbox's font file. Without one, Android's default typeface is used, which can lay
   * out text very differently from the NOTE app; the status says which case applied, so the caller
   * can report it.
   */
  private fun loadTypeface(fontPath: String?): TypefaceResult {
    if (fontPath.isNullOrBlank()) {
      return TypefaceResult(null, "default: no fontPath")
    }

    val file = File(fontPath)
    if (!file.exists()) {
      return TypefaceResult(null, "default: font file missing")
    }
    if (!file.canRead()) {
      return TypefaceResult(null, "default: font file not readable")
    }

    return try {
      TypefaceResult(Typeface.createFromFile(file), "loaded")
    } catch (error: Throwable) {
      TypefaceResult(null, "default: font load failed: ${error.javaClass.simpleName}: ${error.message}")
    }
  }
}
